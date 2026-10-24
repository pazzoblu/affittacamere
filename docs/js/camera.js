import {
  sb, configured, esc, paragraphs, photoUrl, euro, loadContent, notConfiguredMessage, ROOM_PUBLIC_COLS,
  isoDate, addDays, nightsBetween, fmtDate, MONTHS, WEEKDAYS, functionError,
} from './common.js';

document.getElementById('year').textContent = new Date().getFullYear();

const MONTHS_AHEAD = 12;
const today = isoDate(new Date());
const busyNights = new Set();   // notti occupate (giorno di arrivo incluso, partenza esclusa)
let room = null;
let content = {};
let quote = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let checkIn = null;
let checkOut = null;

function msg(el, text, kind) {
  el.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : '';
}

function rangeFree(from, to) {
  for (let d = from; d < to; d = addDays(d, 1)) if (busyNights.has(d)) return false;
  return true;
}

function renderGallery(photos) {
  const main = document.getElementById('main-photo');
  const caption = document.getElementById('caption');
  const thumbs = document.getElementById('thumbs');
  if (!photos.length) { thumbs.innerHTML = ''; return; }
  const show = i => {
    main.style.backgroundImage = `url("${photoUrl(photos[i].path)}")`;
    caption.textContent = photos[i].caption || '';
    thumbs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', i === j));
  };
  thumbs.innerHTML = photos.length > 1 ? photos.map((p, i) =>
    `<button type="button" data-i="${i}" style="background-image:url('${photoUrl(p.path)}')"
       aria-label="Foto ${i + 1}"></button>`).join('') : '';
  thumbs.onclick = e => { const b = e.target.closest('button'); if (b) show(Number(b.dataset.i)); };
  show(0);
}

function renderCalendar() {
  document.getElementById('cal-title').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  const now = new Date();
  const monthIdx = (viewYear - now.getFullYear()) * 12 + viewMonth - now.getMonth();
  document.getElementById('prev').disabled = monthIdx <= 0;
  document.getElementById('next').disabled = monthIdx >= MONTHS_AHEAD - 1;

  const first = new Date(viewYear, viewMonth, 1);
  const lead = (first.getDay() + 6) % 7; // lunedì = 0
  const days = new Date(viewYear, viewMonth + 1, 0).getDate();
  let html = WEEKDAYS.map(w => `<div class="wd">${w}</div>`).join('');
  html += '<div></div>'.repeat(lead);

  for (let n = 1; n <= days; n++) {
    const d = isoDate(new Date(viewYear, viewMonth, n));
    const busy = busyNights.has(d);
    // un giorno occupato resta cliccabile solo come giorno di partenza
    const canCheckout = checkIn && !checkOut && d > checkIn && rangeFree(checkIn, d);
    const disabled = d < today || (busy && !canCheckout);
    const cls = ['day'];
    if (busy) cls.push('busy');
    if (d === checkIn || d === checkOut) cls.push('sel');
    else if (checkIn && checkOut && d > checkIn && d < checkOut) cls.push('in-range');
    html += `<button type="button" class="${cls.join(' ')}" data-d="${d}" ${disabled ? 'disabled' : ''}>${n}</button>`;
  }
  document.getElementById('cal').innerHTML = html;
}

function pickDay(d) {
  if (checkIn && !checkOut && d > checkIn && rangeFree(checkIn, d)) {
    checkOut = d;
  } else if (!busyNights.has(d)) {
    checkIn = d;
    checkOut = null;
  }
  updateStay();
  renderCalendar();
}

function setButtons(canRequest, canPay) {
  document.getElementById('send').disabled = !canRequest;
  document.getElementById('pay').disabled = !canPay;
}

async function updateStay() {
  const stay = document.getElementById('stay');
  const payBox = document.getElementById('pay-box');
  quote = null;
  payBox.hidden = true;
  setButtons(false, false);
  if (!checkIn) {
    stay.textContent = 'Seleziona sul calendario il giorno di arrivo e quello di partenza.';
    return;
  }
  if (!checkOut) {
    stay.innerHTML = `Arrivo <strong>${fmtDate(checkIn)}</strong> · ora scegli il giorno di partenza`;
    return;
  }
  const n = nightsBetween(checkIn, checkOut);
  const head = `<strong>${fmtDate(checkIn)} → ${fmtDate(checkOut)}</strong> · ${n} ${n === 1 ? 'notte' : 'notti'}`;
  if (n < room.min_nights) {
    stay.innerHTML = `${head}<br>Il soggiorno minimo è di ${room.min_nights} notti.`;
    return;
  }
  stay.innerHTML = head;
  const [ci, co] = [checkIn, checkOut];
  const { data, error } = await sb.rpc('quote_booking', { p_room: room.id, p_check_in: ci, p_check_out: co });
  if (ci !== checkIn || co !== checkOut) return; // l'ospite ha già cambiato date
  if (error) { stay.innerHTML = `${head}<br>${esc(error.message)}`; return; }
  quote = data[0];
  if (quote.total != null) stay.innerHTML = `${head}<span class="total">Totale ${euro(quote.total)}</span>`;
  if (!quote.available) {
    stay.innerHTML += '<br>Spiacenti, le date non sono più disponibili.';
    return;
  }
  setButtons(true, quote.online_payment);
  if (quote.online_payment) {
    document.getElementById('dep-pct').textContent = quote.deposit_percent;
    document.getElementById('dep-amount').textContent = euro(quote.deposit);
    document.getElementById('tot-amount').textContent = euro(quote.total);
    document.getElementById('pay-terms').textContent = content.condizioni_cancellazione || '';
    payBox.hidden = false;
  }
}

async function loadBusy() {
  const to = isoDate(new Date(new Date().getFullYear(), new Date().getMonth() + MONTHS_AHEAD, 1));
  const { data, error } = await sb.rpc('room_busy_ranges', { p_room: room.id, p_from: today, p_to: to });
  if (error) throw error;
  busyNights.clear();
  for (const r of data) for (let d = r.check_in; d < r.check_out; d = addDays(d, 1)) busyNights.add(d);
}

async function submitForm(e) {
  e.preventDefault();
  const f = e.target;
  const out = document.getElementById('req-msg');
  if (!checkIn || !checkOut) return;
  const paying = e.submitter?.value === 'pay';
  if (!f.email.reportValidity()) return;
  setButtons(false, false);
  msg(out, '');

  if (paying) {
    const { data, error } = await sb.functions.invoke('payments', {
      body: {
        action: 'checkout', room_id: room.id, check_in: checkIn, check_out: checkOut,
        email: f.email.value, guests: Number(f.guests.value), message: f.message.value, mode: f.mode.value,
      },
    });
    if (error) {
      msg(out, await functionError(error), 'err');
      setButtons(true, true);
      return;
    }
    msg(out, 'Ti stiamo portando alla pagina di pagamento sicura…', 'ok');
    location.href = data.url;
    return;
  }

  const { data: code, error } = await sb.rpc('request_booking', {
    p_room: room.id, p_check_in: checkIn, p_check_out: checkOut,
    p_email: f.email.value, p_guests: Number(f.guests.value), p_message: f.message.value,
  });
  if (error) {
    msg(out, error.message, 'err');
    setButtons(true, !!quote?.online_payment);
    return;
  }
  out.innerHTML = `<div class="msg ok">Richiesta inviata! Il tuo codice prenotazione è
    <strong class="code">${esc(code)}</strong>: annotalo. Con il codice e la tua email puoi seguire
    la richiesta nella pagina <a href="prenotazione.html?c=${encodeURIComponent(code)}">La mia prenotazione</a>.</div>`;
  f.reset();
  checkIn = checkOut = null;
  updateStay();
  renderCalendar();
}

async function init() {
  const slug = new URLSearchParams(location.search).get('c');
  const [c, res] = await Promise.all([
    loadContent(),
    sb.from('rooms').select(`${ROOM_PUBLIC_COLS}, room_photos(path, caption, sort_order)`)
      .eq('slug', slug ?? '').eq('published', true).maybeSingle(),
  ]);
  content = c;
  document.querySelectorAll('[data-c]').forEach(el => { el.textContent = content[el.dataset.c] || ''; });
  if (res.error) throw res.error;
  room = res.data;
  if (!room) {
    document.getElementById('config-msg').innerHTML = '<div class="notice">Alloggio non trovato.</div>';
    return;
  }

  document.title = `${room.name} · ${content.titolo || ''}`;
  document.getElementById('room-name').textContent = room.name;
  document.getElementById('room-meta').innerHTML =
    `<span>👤 fino a ${room.capacity} ${room.capacity === 1 ? 'ospite' : 'ospiti'}` +
    (room.min_nights > 1 ? ` · minimo ${room.min_nights} notti` : '') + '</span>' +
    (room.price_from != null ? `<span class="price">da <strong>${euro(room.price_from)}</strong>/notte</span>` : '');
  document.getElementById('amenities').innerHTML = room.amenities.map(a => `<li>${esc(a)}</li>`).join('');
  document.getElementById('room-desc').innerHTML = paragraphs(room.description);
  document.getElementById('guests').innerHTML =
    Array.from({ length: room.capacity }, (_, i) => `<option>${i + 1}</option>`).join('');
  renderGallery([...room.room_photos].sort((a, b) => a.sort_order - b.sort_order));
  document.getElementById('room').hidden = false;

  await loadBusy();
  renderCalendar();

  document.getElementById('cal').onclick = e => {
    const b = e.target.closest('button.day');
    if (b && !b.disabled) pickDay(b.dataset.d);
  };
  document.getElementById('prev').onclick = () => {
    if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  };
  document.getElementById('next').onclick = () => {
    if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  };
  document.getElementById('req-form').onsubmit = submitForm;
}

if (!configured) {
  notConfiguredMessage(document.getElementById('config-msg'));
} else {
  init().catch(err => {
    console.error(err);
    document.getElementById('config-msg').innerHTML =
      `<div class="notice">Errore nel caricamento: ${esc(err.message)}</div>`;
  });
}
