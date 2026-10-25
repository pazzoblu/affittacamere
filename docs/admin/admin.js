import {
  sb, configured, esc, photoUrl, euro, isoDate, parseIso, addDays, nightsBetween, fmtDate, MONTHS, functionError,
} from '../js/common.js';
import { SUPABASE_URL } from '../js/config.js';

const $ = id => document.getElementById(id);
const SOURCE_LABEL = { diretta: 'Diretta', sito: 'Dal sito', booking: 'Booking', airbnb: 'Airbnb', altro: 'Altro' };
const CHANNEL_LABEL = { booking: 'Booking', airbnb: 'Airbnb', altro: 'Altro' };
const today = () => isoDate(new Date());

let rooms = [];
let me = { id: null, email: '', roles: [] };
// l'admin ha tutti i ruoli
const can = role => me.roles.includes('admin') || me.roles.includes(role);
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedRoomId = null;

function msg(el, text, kind = 'err') {
  el.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : '';
  // le maschere con la barra in alto ripetono l'esito accanto ai pulsanti di salvataggio
  const status = el.closest('form')?.querySelector('.form-top .save-status');
  if (status) {
    clearTimeout(status._timer);
    status.className = `save-status ${kind}`;
    status.textContent = text || '';
    if (text && kind === 'ok') status._timer = setTimeout(() => { status.textContent = ''; }, 5000);
    return;
  }
  if (text) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// pulsanti "Chiudi/Annulla" della barra in alto delle finestre
document.querySelectorAll('dialog [data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });

function showView(id) {
  for (const v of ['login-view', 'msg-view', 'app-view']) $(v).hidden = v !== id;
}

function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'alloggio';
}

// Ridimensiona le foto prima del caricamento (max 1920px, JPEG): pagine veloci e spazio risparmiato
async function resizeImage(file, max = 1920) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
}

async function uploadImage(file, folder) {
  const blob = await resizeImage(file);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

async function loadRooms() {
  const { data, error } = await sb.from('rooms').select('*').order('sort_order').order('name');
  if (error) throw error;
  rooms = data;
  const opts = rooms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  $('bk-form').room_id.innerHTML = opts;
}

const roomName = id => rooms.find(r => r.id === id)?.name ?? '?';

// =====================================================================
// Tabs
// =====================================================================
const loaders = {
  calendario: renderTimeline,
  prenotazioni: renderBookingList,
  messaggi: renderMessages,
  camere: renderRoomList,
  contenuti: loadContentForm,
  sync: renderSync,
  utenti: renderUsers,
};

// una scheda è visibile se l'utente ha almeno uno dei ruoli indicati in data-role
const tabAllowed = btn => btn.dataset.role.split(' ').some(can);

// Aggiornamento dei dati: ogni minuto, al ritorno sulla scheda e col pulsante ↻.
// Solo le schede di sola consultazione: mai mentre si compila (alloggi, testi, finestre aperte).
const AUTO_REFRESH_TABS = ['calendario', 'prenotazioni', 'messaggi', 'sync', 'utenti'];
let refreshing = false;

async function refreshData({ manual = false } = {}) {
  if (!started || refreshing || (!manual && document.hidden)) return;
  if (document.querySelector('dialog[open]')) return;
  const tab = document.querySelector('#tabs button.on')?.dataset.tab;
  refreshing = true;
  try {
    await refreshBadge();
    if (tab && (AUTO_REFRESH_TABS.includes(tab) || manual)) {
      // il calendario resta dove l'utente l'aveva fatto scorrere
      const wrap = document.querySelector('.timeline-wrap');
      const x = wrap?.scrollLeft;
      await loaders[tab]();
      if (tab === 'calendario' && !manual && wrap) wrap.scrollLeft = x;
    }
    $('refresh-btn').title = `Aggiorna i dati (ultimo aggiornamento alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })})`;
  } catch (err) {
    if (manual) showError(err);
  } finally {
    refreshing = false;
  }
}
setInterval(() => refreshData(), 60000);
$('refresh-btn').onclick = () => refreshData({ manual: true });

function openTab(name) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelector(`#tabs button[data-tab="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
  try { localStorage.setItem('admin-tab', name); } catch { /* storage non disponibile */ }
  loaders[name]().catch(showError);
}

function showError(err) {
  console.error(err);
  alert('Errore: ' + (err.message || err));
}

async function refreshBadge() {
  if (!can('prenotazioni')) return;
  const [req, unread] = await Promise.all([
    sb.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'richiesta'),
    sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ]);
  for (const [id, count] of [['req-badge', req.count], ['msg-badge', unread.count]]) {
    $(id).hidden = !count;
    $(id).textContent = count || '';
  }
}

// =====================================================================
// Calendario (timeline mensile: righe = alloggi, colonne = giorni)
// =====================================================================
async function renderTimeline() {
  const first = isoDate(new Date(calYear, calMonth, 1));
  const next = isoDate(new Date(calYear, calMonth + 1, 1));
  const days = nightsBetween(first, next);
  $('cal-title').textContent = `${MONTHS[calMonth]} ${calYear}`;

  const { data: bookings, error } = await sb.from('bookings').select('*')
    .neq('status', 'annullata').lt('check_in', next).gt('check_out', first).order('check_in');
  if (error) throw error;

  const tl = $('timeline');
  tl.style.gridTemplateColumns = `var(--lbl, 150px) repeat(${days}, minmax(28px, 1fr))`;
  const t = today();
  const dayInfo = Array.from({ length: days }, (_, i) => {
    const d = addDays(first, i);
    const wd = parseIso(d).getDay();
    return { d, we: wd === 0 || wd === 6, today: d === t, wd };
  });
  const WD = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];

  let html = '<div class="hd" style="grid-row:1;grid-column:1"></div>';
  dayInfo.forEach((x, i) => {
    html += `<div class="hd ${x.we ? 'we' : ''} ${x.today ? 'today' : ''}" style="grid-row:1;grid-column:${i + 2}">
      ${WD[x.wd]}<br>${i + 1}</div>`;
  });

  if (!rooms.length) {
    tl.innerHTML = html + `<div class="room-lbl" style="grid-row:2;grid-column:1 / -1">Nessun alloggio: crealo nella scheda Alloggi.</div>`;
    return;
  }

  let row = 2;
  for (const room of rooms) {
    const list = bookings.filter(b => b.room_id === room.id);
    // assegna ogni prenotazione alla prima "corsia" libera, così le sovrapposizioni restano visibili
    const laneEnds = [];
    for (const b of list) {
      let lane = laneEnds.findIndex(end => end <= b.check_in);
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(null); }
      laneEnds[lane] = b.check_out;
      b._lane = lane;
      b._conflict = b.status === 'confermata' && list.some(o => o !== b && o.status === 'confermata'
        && o.check_in < b.check_out && o.check_out > b.check_in);
    }
    const lanes = Math.max(1, laneEnds.length);
    const span = `${row} / span ${lanes}`;

    html += `<div class="room-lbl" style="grid-row:${span};grid-column:1">${esc(room.name)}</div>`;
    dayInfo.forEach((x, i) => {
      html += `<div class="cell ${x.we ? 'we' : ''} ${x.today ? 'today' : ''}" data-room="${room.id}" data-d="${x.d}"
        style="grid-row:${span};grid-column:${i + 2}"></div>`;
    });
    for (const b of list) {
      const s = Math.max(0, nightsBetween(first, b.check_in));
      const e = Math.min(days, nightsBetween(first, b.check_out));
      const cls = ['bar', `bg-${b.source}`, b.status];
      if (b._conflict) cls.push('conflict');
      if (b.check_in < first) cls.push('cont-l');
      if (b.check_out > next) cls.push('cont-r');
      const label = b.ical_source_id ? SOURCE_LABEL[b.source] : b.code;
      if (b.cancel_requested_at && b.status !== 'annullata') cls.push('cancel-req');
      const tip = `${label}${b.guest_email ? ` (${b.guest_email})` : ''} · ${fmtDate(b.check_in)} → ${fmtDate(b.check_out)} · ` +
        SOURCE_LABEL[b.source] + (b.status === 'richiesta' ? ' (da confermare)' : '') +
        (b.cancel_requested_at && b.status !== 'annullata' ? ' · CANCELLAZIONE RICHIESTA' : '') +
        (b._conflict ? ' · SOVRAPPOSTA!' : '');
      html += `<div class="${cls.join(' ')}" data-id="${b.id}" title="${esc(tip)}"
        style="grid-row:${row + b._lane};grid-column:${s + 2} / ${e + 2}">${esc(label)}</div>`;
    }
    row += lanes;
  }
  tl.innerHTML = html;
  tl._bookings = bookings;
  // su schermi stretti il mese non sta tutto: porta in vista la colonna di oggi
  const todayHd = tl.querySelector('.hd.today');
  const wrap = tl.parentElement;
  if (todayHd && wrap.scrollWidth > wrap.clientWidth) {
    wrap.scrollLeft = Math.max(0, todayHd.offsetLeft - (tl.querySelector('.room-lbl')?.offsetWidth ?? 0) - 28);
  }
}

$('timeline').addEventListener('click', e => {
  const bar = e.target.closest('.bar');
  if (bar) return openBooking($('timeline')._bookings.find(b => b.id === bar.dataset.id));
  const cell = e.target.closest('.cell');
  if (cell) openBooking(null, { room_id: cell.dataset.room, check_in: cell.dataset.d });
});
$('cal-prev').onclick = () => { if (--calMonth < 0) { calMonth = 11; calYear--; } renderTimeline().catch(showError); };
$('cal-next').onclick = () => { if (++calMonth > 11) { calMonth = 0; calYear++; } renderTimeline().catch(showError); };
$('cal-today').onclick = () => {
  calYear = new Date().getFullYear(); calMonth = new Date().getMonth();
  renderTimeline().catch(showError);
};
$('new-booking').onclick = () => openBooking(null, {});

// =====================================================================
// Dialog prenotazione
// =====================================================================
let editing = null;

function openBooking(b, defaults = {}) {
  if (!rooms.length) { alert('Crea prima almeno un alloggio.'); return; }
  editing = b;
  const f = $('bk-form');
  const v = b ?? {
    room_id: defaults.room_id ?? rooms[0].id,
    check_in: defaults.check_in ?? today(),
    check_out: addDays(defaults.check_in ?? today(), 1),
    status: 'confermata', source: 'diretta',
  };
  for (const k of ['room_id', 'check_in', 'check_out', 'status', 'source', 'guest_email',
    'guests', 'price', 'amount_paid', 'notes']) {
    f[k].value = v[k] ?? '';
  }
  $('bk-code').innerHTML = !b ? '' : `Codice prenotazione <strong class="code">${esc(b.code)}</strong>` +
    (b.terms_accepted_at ? ` · termini accettati il ${new Date(b.terms_accepted_at).toLocaleString('it-IT',
      { dateStyle: 'short', timeStyle: 'short' })} (versione ${esc(b.terms_version ?? '')})` : '');
  const cancelReq = b?.cancel_requested_at && b.status !== 'annullata';
  $('bk-cancel-req').hidden = !cancelReq;
  $('bk-cancel-req').textContent = cancelReq
    ? `Il cliente ha chiesto la cancellazione il ${new Date(b.cancel_requested_at).toLocaleString('it-IT')}: ` +
      'imposta lo stato "Annullata", rispondigli via email ed eventualmente rimborsa da Stripe.' : '';
  $('bk-pay').hidden = !b;
  $('link-out').innerHTML = '';
  if (b) {
    $('link-amount').value = Math.max(0, Number(b.price ?? 0) - Number(b.amount_paid ?? 0)).toFixed(2);
    renderPayments(b.id);
  }
  $('bk-title').textContent = b ? 'Modifica prenotazione' : 'Nuova prenotazione';
  $('bk-delete').hidden = !b;
  const external = !!b?.ical_source_id;
  $('bk-external').hidden = !external;
  $('bk-external').textContent = external
    ? `Importata da ${SOURCE_LABEL[b.source]}: date e stato si aggiornano dalla sincronizzazione. Puoi aggiungere numero di ospiti, importi e note.`
    : '';
  for (const k of ['room_id', 'check_in', 'check_out', 'status', 'source']) f[k].disabled = external;
  msg($('bk-msg'), '');
  $('bk-dialog').showModal();
}

$('bk-cancel').onclick = () => $('bk-dialog').close();

$('bk-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const rec = {
    guest_email: f.guest_email.value.trim().toLowerCase(),
    guests: f.guests.value ? Number(f.guests.value) : null,
    price: f.price.value ? Number(f.price.value) : null,
    amount_paid: Number(f.amount_paid.value) || 0,
    notes: f.notes.value,
  };
  // lo stato del pagamento segue l'incassato, tranne mentre un pagamento online è in corso
  if (!['in_attesa', 'rimborsato'].includes(editing?.payment_status) || rec.amount_paid !== Number(editing.amount_paid)) {
    rec.payment_status = paymentStatusFor(rec.amount_paid, rec.price);
  }
  if (!editing?.ical_source_id) {
    Object.assign(rec, {
      room_id: f.room_id.value, check_in: f.check_in.value, check_out: f.check_out.value,
      status: f.status.value, source: f.source.value,
    });
    if (rec.check_out <= rec.check_in) { msg($('bk-msg'), 'La partenza deve essere dopo l\'arrivo.'); return; }
    if (rec.status === 'confermata' && !(await confirmNoOverlap(rec, editing?.id))) return;
  }
  const q = editing ? sb.from('bookings').update(rec).eq('id', editing.id) : sb.from('bookings').insert(rec);
  const { error } = await q;
  if (error) { msg($('bk-msg'), error.message); return; }
  $('bk-dialog').close();
  afterBookingChange();
});

$('bk-delete').onclick = async () => {
  const hint = editing.ical_source_id
    ? '\n\nAttenzione: è importata dal portale, alla prossima sincronizzazione ricomparirà se esiste ancora lì.' : '';
  if (!confirm('Eliminare definitivamente questa prenotazione?' + hint)) return;
  const { error } = await sb.from('bookings').delete().eq('id', editing.id);
  if (error) { msg($('bk-msg'), error.message); return; }
  $('bk-dialog').close();
  afterBookingChange();
};

function paymentStatusFor(paid, price) {
  if (!(paid > 0)) return 'nessuno';
  return price != null && paid >= price ? 'pagato' : 'acconto';
}

const PAY_KIND = { acconto: 'Acconto online', totale: 'Saldo online', link: 'Link di pagamento' };
const PAY_STATUS = { in_attesa: 'in attesa', pagato: 'pagato ✓', scaduto: 'scaduto', rimborsato: 'rimborsato' };

async function renderPayments(bookingId) {
  const { data, error } = await sb.from('payments').select('*').eq('booking_id', bookingId).order('created_at');
  if (error) return showError(error);
  $('bk-payments').innerHTML = data.length ? `<ul class="pay-list">${data.map(p => `
    <li><span>${PAY_KIND[p.kind]} · ${new Date(p.created_at).toLocaleDateString('it-IT')}</span>
      <span>${euro(p.amount)} · <strong>${PAY_STATUS[p.status]}</strong></span></li>`).join('')}</ul>`
    : '<p class="muted small">Nessun pagamento online.</p>';
}

$('bk-calc').onclick = async () => {
  const f = $('bk-form');
  const { data, error } = await sb.rpc('quote_price', {
    p_room: f.room_id.value, p_check_in: f.check_in.value, p_check_out: f.check_out.value,
  });
  if (error) return msg($('bk-msg'), error.message);
  if (data == null) return msg($('bk-msg'), 'Manca un prezzo per qualche notte: imposta il listino nella scheda Alloggi.');
  f.price.value = Number(data).toFixed(2);
  msg($('bk-msg'), '');
};

$('link-create').onclick = async () => {
  const amount = Number($('link-amount').value);
  if (!(amount > 0)) return msg($('bk-msg'), 'Inserisci l\'importo da richiedere.');
  const btn = $('link-create');
  btn.disabled = true;
  const { data, error } = await sb.functions.invoke('payments', {
    body: { action: 'link', booking_id: editing.id, amount },
  });
  btn.disabled = false;
  if (error) return msg($('bk-msg'), 'Link non creato: ' + await functionError(error));
  const f = $('bk-form');
  const text = `Buongiorno, ecco il link per il pagamento di ${euro(amount)} per la prenotazione ${editing.code} ` +
    `(soggiorno dal ${fmtDate(f.check_in.value)} al ${fmtDate(f.check_out.value)}): ${data.url}`;
  $('link-out').innerHTML = `<div class="link-box">
    Link valido 23 ore:<br><code>${esc(data.url)}</code>
    <div class="btns">
      <button type="button" class="btn small ghost" id="link-copy">Copia</button>
      <a class="btn small ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
      ${f.guest_email.value ? `<a class="btn small ghost" href="mailto:${esc(f.guest_email.value)}?subject=${encodeURIComponent('Pagamento soggiorno')}&body=${encodeURIComponent(text)}">Email</a>` : ''}
    </div></div>`;
  $('link-copy').onclick = async () => {
    await navigator.clipboard.writeText(data.url);
    $('link-copy').textContent = 'Copiato ✓';
  };
  renderPayments(editing.id);
};

async function confirmNoOverlap(rec, excludeId) {
  let q = sb.from('bookings').select('code, ical_source_id, source, check_in, check_out')
    .eq('room_id', rec.room_id).eq('status', 'confermata')
    .lt('check_in', rec.check_out).gt('check_out', rec.check_in);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q;
  if (error) throw error;
  if (!data.length) return true;
  const list = data.map(o => `• ${o.ical_source_id ? SOURCE_LABEL[o.source] : o.code}: ${fmtDate(o.check_in)} → ${fmtDate(o.check_out)}`).join('\n');
  return confirm(`L'alloggio risulta già occupato in queste date:\n${list}\n\nSalvare comunque?`);
}

function afterBookingChange() {
  refreshBadge();
  const tab = document.querySelector('#tabs button.on').dataset.tab;
  loaders[tab]().catch(showError);
}

// =====================================================================
// Elenco prenotazioni
// =====================================================================
async function renderBookingList() {
  const filter = $('bk-filter').value;
  const t = today();
  let q = sb.from('bookings').select('*');
  if (filter === 'richieste') q = q.or('status.eq.richiesta,and(status.eq.confermata,cancel_requested_at.not.is.null)').order('check_in');
  if (filter === 'prossime') q = q.eq('status', 'confermata').gte('check_out', t).order('check_in');
  if (filter === 'passate') q = q.eq('status', 'confermata').lt('check_out', t).order('check_in', { ascending: false }).limit(200);
  if (filter === 'annullate') q = q.eq('status', 'annullata').order('check_in', { ascending: false }).limit(200);
  const { data, error } = await q;
  if (error) throw error;

  const el = $('bk-list');
  if (!data.length) { el.innerHTML = '<p class="muted">Nessuna prenotazione.</p>'; return; }
  el.innerHTML = `<table class="bk-table">
    <thead><tr><th>Date</th><th>Alloggio</th><th>Cliente</th><th>Canale</th><th>Note</th><th>Pagamento</th><th>Stato</th><th></th></tr></thead>
    <tbody>${data.map(b => {
      const n = nightsBetween(b.check_in, b.check_out);
      const cancelReq = b.cancel_requested_at && b.status !== 'annullata';
      return `<tr${cancelReq ? ' class="row-alert"' : ''}>
        <td data-label="Date">${fmtDate(b.check_in)} → ${fmtDate(b.check_out)}<br><span class="muted small">${n} ${n === 1 ? 'notte' : 'notti'}</span></td>
        <td data-label="Alloggio">${esc(roomName(b.room_id))}</td>
        <td data-label="Cliente"><strong class="code">${esc(b.code)}</strong>${b.guests ? ` <span class="muted small">(${b.guests} osp.)</span>` : ''}
          ${b.guest_email ? `<br><a class="small" href="mailto:${esc(b.guest_email)}?subject=${encodeURIComponent('Prenotazione ' + b.code)}">${esc(b.guest_email)}</a>` : ''}</td>
        <td data-label="Canale"><span class="pill bg-${b.source}">${SOURCE_LABEL[b.source]}</span></td>
        <td class="small" data-label="Note">${esc(b.notes)}</td>
        <td data-label="Pagamento">${paymentCell(b)}</td>
        <td data-label="Stato"><span class="st ${b.status}">${b.status}</span>${cancelReq ? '<br><span class="paid in_attesa">cancellazione richiesta</span>' : ''}</td>
        <td class="act">
          ${b.status === 'richiesta' ? `<button class="btn small" data-act="ok" data-id="${b.id}">Conferma</button>
            <button class="btn small danger ghost" data-act="no" data-id="${b.id}">Rifiuta</button>` : ''}
          <button class="btn small ghost" data-act="edit" data-id="${b.id}">Modifica</button>
        </td></tr>`;
    }).join('')}</tbody></table>`;
  el._data = data;
}

function paymentCell(b) {
  const label = { nessuno: '', in_attesa: 'pagamento online in corso', acconto: 'acconto', pagato: 'saldato', rimborsato: 'rimborsato' };
  if (b.price == null && !(b.amount_paid > 0)) return '<span class="muted small">—</span>';
  return `<span class="small">${euro(b.amount_paid)}${b.price != null ? ` / ${euro(b.price)}` : ''}</span>` +
    (label[b.payment_status] ? `<br><span class="paid ${b.payment_status}">${label[b.payment_status]}</span>` : '');
}

$('bk-filter').onchange = () => renderBookingList().catch(showError);
$('bk-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const b = $('bk-list')._data.find(x => x.id === btn.dataset.id);
  if (btn.dataset.act === 'edit') return openBooking(b);
  if (btn.dataset.act === 'ok' && !(await confirmNoOverlap(b, b.id))) return;
  if (btn.dataset.act === 'no' && !confirm('Rifiutare la richiesta? Ricordati di avvisare l\'ospite.')) return;
  const status = btn.dataset.act === 'ok' ? 'confermata' : 'annullata';
  const { error } = await sb.from('bookings').update({ status }).eq('id', b.id);
  if (error) return showError(error);
  afterBookingChange();
});

// =====================================================================
// Alloggi
// =====================================================================
async function renderRoomList() {
  $('room-list').innerHTML = rooms.map(r => `
    <li data-id="${r.id}" class="${r.id === selectedRoomId ? 'on' : ''}">
      <span>${esc(r.name)}</span>${r.published ? '' : '<span class="off">non pubblicata</span>'}
    </li>`).join('') || '<li class="muted">Nessun alloggio</li>';
  if (selectedRoomId) await renderRoomEditor(rooms.find(r => r.id === selectedRoomId));
}

$('room-list').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  selectedRoomId = li.dataset.id;
  renderRoomList().catch(showError);
});
$('new-room').onclick = () => {
  selectedRoomId = null;
  document.querySelectorAll('#room-list li').forEach(li => li.classList.remove('on'));
  renderRoomEditor(null).catch(showError);
};

async function renderRoomEditor(r) {
  const isNew = !r;
  r = r ?? { name: '', slug: '', short_description: '', description: '', capacity: 2, price_from: null,
    amenities: [], sort_order: rooms.length, published: true };
  // l'anagrafica la modifica il ruolo "camere", i prezzi il ruolo "prezzi" (il database fa lo stesso controllo)
  const editInfo = can('camere');
  const editPrice = can('prezzi') && !isNew;
  const ed = $('room-editor');
  ed.innerHTML = `
    <form id="room-form">
      <div class="form-top form-top-page">
        <h2>${isNew ? 'Nuovo alloggio' : esc(r.name)}</h2>
        ${editInfo || editPrice ? `<div class="form-top-actions"><button class="btn" type="submit">${isNew ? 'Crea alloggio' : 'Salva'}</button></div>` : ''}
        <div class="save-status" aria-live="polite"></div>
      </div>
      <fieldset class="plain" ${editInfo ? '' : 'disabled'}>
        <div class="grid2">
          <label>Nome<input name="name" required value="${esc(r.name)}"></label>
          <label>Indirizzo pagina (slug)<input name="slug" required pattern="[a-z0-9\\-]+" value="${esc(r.slug)}"
            title="solo lettere minuscole, numeri e trattini"></label>
        </div>
        <label>Descrizione breve (nella scheda della home)<input name="short_description" maxlength="200" value="${esc(r.short_description)}"></label>
        <label>Descrizione completa (riga vuota = nuovo paragrafo)<textarea name="description" rows="7">${esc(r.description)}</textarea></label>
        <div class="grid2">
          <label>Ospiti massimi<input name="capacity" type="number" min="1" required value="${r.capacity}"></label>
          <label>Ordine in elenco<input name="sort_order" type="number" value="${r.sort_order}"></label>
        </div>
        <label>Servizi (separati da virgola)<input name="amenities" value="${esc(r.amenities.join(', '))}"
          placeholder="Wi-Fi, Aria condizionata, Bagno privato, TV"></label>
        <div class="grid2">
          <label>CIN (Codice Identificativo Nazionale, obbligatorio negli annunci)<input name="cin" maxlength="40" value="${esc(r.cin ?? '')}"
            placeholder="es. IT012345C2XXXXXXXX"></label>
          <label>Codice regionale (CIR), se previsto<input name="cir" maxlength="40" value="${esc(r.cir ?? '')}"></label>
        </div>
        <label><input type="checkbox" name="published" ${r.published ? 'checked' : ''}>Pubblicata sul sito</label>
      </fieldset>
      ${isNew ? '' : `<fieldset class="plain" ${editPrice ? '' : 'disabled'}>
        <h3 class="sub">Prezzi${editPrice ? '' : ' <span class="muted small">(li gestisce chi ha il ruolo Prezzi)</span>'}</h3>
        <div class="grid2">
          <label>Prezzo base a notte (€)<input name="price_from" type="number" min="0" step="0.01" value="${r.price_from ?? ''}"></label>
          <label>Prezzo notti di venerdì e sabato (€, vuoto = base)<input name="price_weekend" type="number" min="0" step="0.01" value="${r.price_weekend ?? ''}"></label>
          <label>Soggiorno minimo (notti)<input name="min_nights" type="number" min="1" required value="${r.min_nights ?? 1}"></label>
          <label>Sconto da 7 notti (%)<input name="discount_week" type="number" min="0" max="90" step="0.5" value="${Number(r.discount_week ?? 0)}"></label>
          <label>Sconto da 28 notti (%)<input name="discount_month" type="number" min="0" max="90" step="0.5" value="${Number(r.discount_month ?? 0)}"></label>
        </div>
        <p class="muted small">Gli sconti si applicano al totale del soggiorno; da 28 notti vale quello mensile.</p>
      </fieldset>`}
      <div class="actions">
        ${isNew || !editInfo ? '' : '<button type="button" class="btn danger ghost" id="room-del">Elimina alloggio</button>'}
        <span class="spacer"></span>
        ${editInfo || editPrice ? `<button class="btn" type="submit">${isNew ? 'Crea alloggio' : 'Salva'}</button>` : ''}
      </div>
      <div id="room-msg"></div>
    </form>
    ${isNew ? '<p class="muted small">Dopo aver creato l’alloggio potrai caricare le foto; i prezzi li imposta chi ha il ruolo Prezzi.</p>' : `
      <div id="season-section" ${editPrice ? '' : 'hidden'}>
      <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
      <h2>Prezzi stagionali</h2>
      <p class="muted small">Nei periodi indicati (date delle notti, estremi inclusi) sostituiscono i prezzi base.
        Se due periodi si sovrappongono vale quello che inizia più tardi.</p>
      <div id="seasons"></div>
      <form class="season-add" id="season-form">
        <label>Nome<input name="name" placeholder="es. Agosto"></label>
        <label>Dal<input name="date_from" type="date" required></label>
        <label>Al<input name="date_to" type="date" required></label>
        <label>€/notte<input name="price_night" type="number" min="0" step="0.01" required></label>
        <label>€ ven/sab<input name="price_weekend" type="number" min="0" step="0.01"></label>
        <button class="btn small" type="submit">Aggiungi</button>
      </form>
      <div id="season-msg"></div>
      </div>
      <div id="photo-section" ${editInfo ? '' : 'hidden'}>
      <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
      <h2>Foto</h2>
      <p class="muted small">La prima foto è la copertina. Le immagini vengono ridimensionate automaticamente.</p>
      <div class="photos" id="photos"></div>
      <input type="file" id="photo-files" accept="image/*" multiple aria-label="Aggiungi foto dell'alloggio">
      <div id="photo-msg"></div>
      </div>`}`;

  const f = $('room-form');
  if (isNew) f.name.addEventListener('input', () => { f.slug.value = slugify(f.name.value); });
  f.onsubmit = async e => {
    e.preventDefault();
    // si inviano solo i campi che l'utente può modificare
    const rec = {};
    if (editInfo) Object.assign(rec, {
      name: f.name.value.trim(), slug: f.slug.value.trim(),
      short_description: f.short_description.value.trim(), description: f.description.value,
      capacity: Number(f.capacity.value),
      sort_order: Number(f.sort_order.value) || 0, published: f.published.checked,
      amenities: f.amenities.value.split(',').map(s => s.trim()).filter(Boolean),
      cin: f.cin.value.trim().toUpperCase(), cir: f.cir.value.trim(),
    });
    if (editPrice) Object.assign(rec, {
      min_nights: Number(f.min_nights.value) || 1,
      price_from: f.price_from.value ? Number(f.price_from.value) : null,
      price_weekend: f.price_weekend.value ? Number(f.price_weekend.value) : null,
      discount_week: Number(f.discount_week.value) || 0,
      discount_month: Number(f.discount_month.value) || 0,
    });
    const q = isNew ? sb.from('rooms').insert(rec).select().single() : sb.from('rooms').update(rec).eq('id', r.id).select().single();
    const { data, error } = await q;
    if (error) {
      msg($('room-msg'), error.code === '23505' ? 'Esiste già un alloggio con questo indirizzo (slug).' : error.message);
      return;
    }
    selectedRoomId = data.id;
    await loadRooms();
    await renderRoomList();
    msg($('room-msg'), 'Salvato.', 'ok');
  };

  if (isNew) return;
  if (editInfo) $('room-del').onclick = async () => {
    if (!confirm(`Eliminare l'alloggio "${r.name}" con tutte le sue foto e prenotazioni?`)) return;
    const { data: photos } = await sb.from('room_photos').select('path').eq('room_id', r.id);
    if (photos?.length) await sb.storage.from('photos').remove(photos.map(p => p.path));
    const { error } = await sb.from('rooms').delete().eq('id', r.id);
    if (error) return msg($('room-msg'), error.message);
    selectedRoomId = null;
    await loadRooms();
    await renderRoomList();
    $('room-editor').innerHTML = '<p class="muted">Alloggio eliminato.</p>';
  };
  $('photo-files').onchange = async e => {
    const files = [...e.target.files];
    const { data: existing } = await sb.from('room_photos').select('sort_order').eq('room_id', r.id);
    let order = Math.max(-1, ...(existing ?? []).map(p => p.sort_order)) + 1;
    for (const [i, file] of files.entries()) {
      msg($('photo-msg'), `Caricamento ${i + 1} di ${files.length}…`, 'ok');
      try {
        const path = await uploadImage(file, `rooms/${r.id}`);
        const { error } = await sb.from('room_photos').insert({ room_id: r.id, path, sort_order: order++ });
        if (error) throw error;
      } catch (err) {
        msg($('photo-msg'), `Errore su ${file.name}: ${err.message}`);
        break;
      }
    }
    e.target.value = '';
    if ($('photo-msg').textContent.startsWith('Caricamento')) msg($('photo-msg'), '');
    renderPhotos(r.id);
  };
  renderPhotos(r.id);

  $('season-form').onsubmit = async e => {
    e.preventDefault();
    const sf = e.target;
    if (sf.date_to.value < sf.date_from.value) return msg($('season-msg'), 'La data finale è prima di quella iniziale.');
    const { error } = await sb.from('season_prices').insert({
      room_id: r.id, name: sf.name.value.trim(), date_from: sf.date_from.value, date_to: sf.date_to.value,
      price_night: Number(sf.price_night.value),
      price_weekend: sf.price_weekend.value ? Number(sf.price_weekend.value) : null,
    });
    if (error) return msg($('season-msg'), error.message);
    sf.reset();
    msg($('season-msg'), '');
    renderSeasons(r.id);
  };
  renderSeasons(r.id);
}

async function renderSeasons(roomId) {
  const { data, error } = await sb.from('season_prices').select('*').eq('room_id', roomId).order('date_from');
  if (error) return showError(error);
  const el = $('seasons');
  if (!el) return;
  el.innerHTML = data.length ? `<table class="seasons">
    <thead><tr><th>Periodo</th><th>Notti</th><th>€/notte</th><th>€ ven/sab</th><th></th></tr></thead>
    <tbody>${data.map(s => `<tr${s.date_to < today() ? ' class="muted"' : ''}>
      <td data-label="Periodo">${esc(s.name) || '—'}</td>
      <td data-label="Notti">${fmtDate(s.date_from)} → ${fmtDate(s.date_to)}</td>
      <td data-label="€/notte">${euro(s.price_night)}</td>
      <td data-label="€ ven/sab">${s.price_weekend != null ? euro(s.price_weekend) : '<span class="muted">come notte</span>'}</td>
      <td><button class="link small" data-del-season="${s.id}">elimina</button></td>
    </tr>`).join('')}</tbody></table>` : '<p class="muted small">Nessun periodo: si usano sempre i prezzi base.</p>';
  el.onclick = async e => {
    const b = e.target.closest('[data-del-season]');
    if (!b || !confirm('Eliminare questo periodo?')) return;
    const { error: err } = await sb.from('season_prices').delete().eq('id', b.dataset.delSeason);
    if (err) return showError(err);
    renderSeasons(roomId);
  };
}

async function renderPhotos(roomId) {
  const { data: photos, error } = await sb.from('room_photos').select('*').eq('room_id', roomId).order('sort_order');
  if (error) return showError(error);
  const el = $('photos');
  if (!el) return;
  el.innerHTML = photos.map((p, i) => `
    <div class="photo" data-id="${p.id}">
      <div class="img"><img src="${photoUrl(p.path)}" alt="${esc(p.caption || `Foto ${i + 1}`)}" loading="lazy"></div>
      <div class="ctl">
        <input data-cap value="${esc(p.caption)}" placeholder="Didascalia (è anche il testo alternativo della foto)"
          aria-label="Didascalia della foto ${i + 1}">
        <div class="btns">
          <button type="button" data-mv="-1" ${i === 0 ? 'disabled' : ''} title="Sposta prima" aria-label="Sposta prima la foto ${i + 1}">←</button>
          <button type="button" data-mv="1" ${i === photos.length - 1 ? 'disabled' : ''} title="Sposta dopo" aria-label="Sposta dopo la foto ${i + 1}">→</button>
          <button type="button" class="del" data-del title="Elimina" aria-label="Elimina la foto ${i + 1}">✕</button>
        </div>
      </div>
    </div>`).join('') || '<p class="muted small">Nessuna foto.</p>';

  el.onclick = async e => {
    const card = e.target.closest('.photo');
    if (!card) return;
    const idx = photos.findIndex(p => p.id === card.dataset.id);
    const p = photos[idx];
    if (e.target.closest('[data-del]')) {
      if (!confirm('Eliminare questa foto?')) return;
      await sb.storage.from('photos').remove([p.path]);
      const { error: err } = await sb.from('room_photos').delete().eq('id', p.id);
      if (err) return showError(err);
      return renderPhotos(roomId);
    }
    const mv = e.target.closest('[data-mv]');
    if (mv && !mv.disabled) {
      const j = idx + Number(mv.dataset.mv);
      // riscrive l'ordine di tutte le foto per evitare valori duplicati
      const order = photos.map(x => x.id);
      [order[idx], order[j]] = [order[j], order[idx]];
      await Promise.all(order.map((id, i) => sb.from('room_photos').update({ sort_order: i }).eq('id', id)));
      renderPhotos(roomId);
    }
  };
  el.onchange = async e => {
    if (!e.target.matches('[data-cap]')) return;
    const id = e.target.closest('.photo').dataset.id;
    const { error: err } = await sb.from('room_photos').update({ caption: e.target.value.trim() }).eq('id', id);
    if (err) showError(err);
  };
}

// =====================================================================
// Testi del sito
// =====================================================================
async function loadContentForm() {
  const { data, error } = await sb.from('site_content').select('key, value');
  if (error) throw error;
  const c = Object.fromEntries(data.map(r => [r.key, r.value]));
  const f = $('content-form');
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = c[el.name] === '1';
    else el.value = c[el.name] ?? '';
  }
  $('hero-preview').style.backgroundImage = c.hero_image ? `url("${photoUrl(c.hero_image)}")` : '';
  $('hero-preview').dataset.path = c.hero_image ?? '';
  // testi del sito: ruolo "camere"; impostazioni dei pagamenti: ruolo "prezzi"
  $('content-texts').hidden = !can('camere');
  $('content-payments').hidden = !can('prezzi');
  loadedContent = c;
}

// testi che fanno parte del contratto: se cambiano, cambia la versione registrata nelle prenotazioni
const TERMS_KEYS = ['termini', 'regolamento', 'condizioni_cancellazione'];
let loadedContent = {};

$('content-form').addEventListener('submit', async e => {
  e.preventDefault();
  const rows = [...e.target.elements].filter(el => el.name && !el.closest('[hidden]')).map(el => ({
    key: el.name, value: el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value.trim(),
  }));
  const termsChanged = rows.some(r => TERMS_KEYS.includes(r.key) && r.value !== (loadedContent[r.key] ?? '').trim());
  if (termsChanged) {
    const now = new Date();
    rows.push({ key: 'termini_versione', value: `${isoDate(now)}T${now.toTimeString().slice(0, 5)}` });
  }
  const { error } = await sb.from('site_content').upsert(rows);
  if (error) return msg($('content-msg'), error.message);
  rows.forEach(r => { loadedContent[r.key] = r.value; });
  msg($('content-msg'), termsChanged ? 'Salvato. Termini aggiornati: le nuove prenotazioni accetteranno questa versione.' : 'Salvato.', 'ok');
});

$('hero-file').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    msg($('content-msg'), 'Caricamento immagine…', 'ok');
    const old = $('hero-preview').dataset.path;
    const path = await uploadImage(file, 'site');
    const { error } = await sb.from('site_content').upsert({ key: 'hero_image', value: path });
    if (error) throw error;
    if (old) await sb.storage.from('photos').remove([old]);
    $('hero-preview').dataset.path = path;
    $('hero-preview').style.backgroundImage = `url("${photoUrl(path)}")`;
    msg($('content-msg'), 'Immagine di copertina aggiornata.', 'ok');
  } catch (err) {
    msg($('content-msg'), err.message);
  }
  e.target.value = '';
};

// =====================================================================
// Sincronizzazione calendari
// =====================================================================
function exportUrl(room, excludeSourceId) {
  const u = `${SUPABASE_URL}/functions/v1/ical-export?room=${room.ical_token}`;
  return excludeSourceId ? `${u}&exclude=${excludeSourceId}` : u;
}

function fmtDateTime(ts) {
  return ts ? new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : 'mai';
}

async function renderSync() {
  const { data: sources, error } = await sb.from('ical_sources').select('*').order('created_at');
  if (error) throw error;
  const el = $('sync-rooms');
  if (!rooms.length) { el.innerHTML = '<p class="muted">Crea prima un alloggio.</p>'; return; }

  el.innerHTML = rooms.map(room => {
    const list = sources.filter(s => s.room_id === room.id);
    return `<div class="card sync-room">
      <h3>${esc(room.name)}</h3>
      ${list.map(s => `
        <div class="src-row">
          <div><span class="pill bg-${s.channel}">${CHANNEL_LABEL[s.channel]}</span></div>
          <div class="info">
            <strong>${esc(s.name)}</strong>
            <div class="url">Importa da: ${esc(s.url)}</div>
            <div>Ultima sincronizzazione: ${fmtDateTime(s.last_sync_at)}
              ${s.last_error ? `<span class="err"> · Errore: ${esc(s.last_error)}</span>` : ''}</div>
            <div style="margin-top:6px">Link da incollare su ${esc(s.name)}:
              <code>${esc(exportUrl(room, s.id))}</code>
              <button class="link small" data-copy="${esc(exportUrl(room, s.id))}">copia</button></div>
          </div>
          <div><button class="btn small danger ghost" data-del-src="${s.id}">Rimuovi</button></div>
        </div>`).join('')}
      <form class="add-src" data-room="${room.id}">
        <label>Portale<select name="channel">
          <option value="booking">Booking</option><option value="airbnb">Airbnb</option><option value="altro">Altro</option>
        </select></label>
        <label>Nome<input name="name" placeholder="es. Booking.com" required></label>
        <label>Link iCal del portale<input name="url" type="url" placeholder="https://..." required></label>
        <button class="btn small" type="submit">Aggiungi</button>
      </form>
      <p class="small muted" style="margin-bottom:0">Link generico (tutte le prenotazioni dell'alloggio):
        <code>${esc(exportUrl(room))}</code> <button class="link small" data-copy="${esc(exportUrl(room))}">copia</button></p>
    </div>`;
  }).join('');
}

$('sync-rooms').addEventListener('click', async e => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard.writeText(copy.dataset.copy);
    copy.textContent = 'copiato ✓';
    setTimeout(() => { copy.textContent = 'copia'; }, 1500);
    return;
  }
  const del = e.target.closest('[data-del-src]');
  if (del) {
    if (!confirm('Rimuovere questo calendario? Verranno eliminate anche le prenotazioni importate da qui.')) return;
    const { error } = await sb.from('ical_sources').delete().eq('id', del.dataset.delSrc);
    if (error) return showError(error);
    renderSync().catch(showError);
  }
});

$('sync-rooms').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const { error } = await sb.from('ical_sources').insert({
    room_id: f.dataset.room, channel: f.channel.value, name: f.name.value.trim(), url: f.url.value.trim(),
  });
  if (error) return showError(error);
  await renderSync();
  runSync();
});

async function runSync() {
  const btn = $('sync-now');
  btn.disabled = true;
  msg($('sync-msg'), 'Sincronizzazione in corso…', 'ok');
  const { data, error } = await sb.functions.invoke('ical-import', { body: {} });
  btn.disabled = false;
  if (error) {
    msg($('sync-msg'), 'Sincronizzazione non riuscita: ' + error.message + ' (la funzione ical-import è stata pubblicata?)');
  } else {
    const ok = data.results.filter(r => !r.error);
    const tot = ok.reduce((a, r) => a + r.events, 0);
    const errs = data.results.length - ok.length;
    msg($('sync-msg'), `Sincronizzati ${ok.length} calendari (${tot} periodi occupati)` +
      (errs ? `, ${errs} con errori: vedi sotto.` : '.'), errs ? 'err' : 'ok');
  }
  renderSync().catch(showError);
  refreshBadge();
}
$('sync-now').onclick = runSync;

// =====================================================================
// Avvio e autenticazione
// =====================================================================
document.querySelectorAll('#tabs button').forEach(b => { b.onclick = () => openTab(b.dataset.tab); });
$('logout').onclick = () => sb.auth.signOut();

// ---------------------------------------------------------------------
// Scadenza della sessione: dopo 30 minuti senza attività bisogna rientrare.
// L'ultima attività è salvata nel browser ed è condivisa fra le schede aperte.
// ---------------------------------------------------------------------
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const ACTIVITY_KEY = 'admin-last-activity';
let lastActivityMem = 0; // se il browser blocca localStorage
let lastActivityWrite = 0;

function getLastActivity() {
  try { return Number(localStorage.getItem(ACTIVITY_KEY)) || lastActivityMem; } catch { return lastActivityMem; }
}
function touchActivity(force = false) {
  const now = Date.now();
  if (!force && now - lastActivityWrite < 15000) return; // al massimo una scrittura ogni 15 secondi
  lastActivityWrite = now;
  lastActivityMem = now;
  try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch { /* storage non disponibile */ }
}
const sessionExpired = () => Date.now() - getLastActivity() > IDLE_LIMIT_MS;

async function expireSession() {
  await sb.auth.signOut();
  msg($('login-msg'), 'Per sicurezza la sessione è scaduta dopo 30 minuti di inattività: accedi di nuovo.');
}

for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
  document.addEventListener(ev, () => { if (started) touchActivity(); }, { passive: true, capture: true });
}
// controllo periodico, e subito quando si torna sulla scheda del browser
setInterval(() => { if (started && sessionExpired()) expireSession(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !started) return;
  if (sessionExpired()) expireSession();
  else refreshData();
});

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  touchActivity(true);
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value, password: f.password.value });
  if (error) msg($('login-msg'), error.message === 'Invalid login credentials' ? 'Email o password errati.' : error.message);
});

// =====================================================================
// Messaggi e notifiche dei clienti
// =====================================================================
const NOTE_KIND = {
  richiesta: ['Nuova richiesta dal sito', 'wait'],
  pagamento: ['Prenotazione pagata online', 'ok'],
  cancellazione: ['Richiesta di cancellazione', 'alert'],
  messaggio: ['Messaggio del cliente', 'info'],
};

async function renderMessages() {
  let q = sb.from('notifications')
    .select('*, bookings(id, code, guest_email, check_in, check_out, room_id, status)')
    .order('created_at', { ascending: false }).limit(200);
  if ($('msg-filter').value === 'nuovi') q = q.is('read_at', null);
  const { data, error } = await q;
  if (error) throw error;
  const el = $('msg-list');
  if (!data.length) { el.innerHTML = '<p class="muted">Nessun messaggio.</p>'; return; }
  el.innerHTML = data.map(n => {
    const b = n.bookings;
    const [label, cls] = NOTE_KIND[n.kind];
    const subject = encodeURIComponent(`Prenotazione ${b?.code ?? ''}`);
    return `<div class="note-card ${n.read_at ? 'read' : ''}" data-id="${n.id}">
      <div class="note-head">
        <span class="note-kind ${cls}">${label}</span>
        <span class="muted small">${new Date(n.created_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      ${b ? `<div class="small"><strong class="code">${esc(b.code)}</strong> · ${esc(roomName(b.room_id))} ·
        ${fmtDate(b.check_in)} → ${fmtDate(b.check_out)} · <span class="st ${b.status}">${b.status}</span></div>` : ''}
      ${n.message ? `<div class="note-text">${esc(n.message)}</div>` : ''}
      <div class="note-actions">
        ${b ? `<button class="btn small ghost" data-note="open">Apri prenotazione</button>` : ''}
        ${b?.guest_email ? `<a class="btn small ghost" href="mailto:${esc(b.guest_email)}?subject=${subject}">Rispondi via email</a>` : ''}
        ${n.read_at ? '' : '<button class="btn small ghost" data-note="read">Segna come letto</button>'}
        <button class="btn small danger ghost" data-note="delete">Elimina</button>
      </div>
    </div>`;
  }).join('');
  el._data = data;
}

$('msg-filter').onchange = () => renderMessages().catch(showError);
$('msg-list').addEventListener('click', async e => {
  const btn = e.target.closest('[data-note]');
  if (!btn) return;
  const n = $('msg-list')._data.find(x => x.id === btn.closest('.note-card').dataset.id);
  if (btn.dataset.note === 'open') {
    const { data: b, error } = await sb.from('bookings').select('*').eq('id', n.bookings.id).single();
    if (error) return showError(error);
    if (!n.read_at) await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
    return openBooking(b);
  }
  if (btn.dataset.note === 'delete' && !confirm('Eliminare il messaggio?')) return;
  const { error } = btn.dataset.note === 'read'
    ? await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    : await sb.from('notifications').delete().eq('id', n.id);
  if (error) return showError(error);
  refreshBadge();
  renderMessages().catch(showError);
});

// =====================================================================
// Utenti (solo amministratori, tramite la funzione "users")
// =====================================================================
const ROLE_LABEL = { admin: 'Amministratore', camere: 'Alloggi', prenotazioni: 'Prenotazioni', prezzi: 'Prezzi' };
let users = [];
let userDialogMode = null; // { mode: 'create' | 'edit' | 'password', user }

async function callUsers(body) {
  const { data, error } = await sb.functions.invoke('users', { body });
  if (error) throw new Error(await functionError(error));
  return data;
}

async function renderUsers() {
  const el = $('user-list');
  try {
    users = (await callUsers({ action: 'list' })).users;
  } catch (err) {
    el.innerHTML = '';
    return msg($('user-msg'), `Elenco utenti non disponibile: ${err.message}. La funzione "users" è stata pubblicata su Supabase? (vedi README)`);
  }
  msg($('user-msg'), '');
  el.innerHTML = `<table class="bk-table">
    <thead><tr><th>Utente</th><th>Ruoli</th><th>Ultimo accesso</th><th></th></tr></thead>
    <tbody>${users.map(u => `<tr>
      <td data-label="Utente">${u.name ? `<strong>${esc(u.name)}</strong><br>` : ''}<span class="small">${esc(u.email)}</span>
        ${u.id === me.id ? ' <span class="muted small">(tu)</span>' : ''}
        ${u.pending ? '<br><span class="paid in_attesa">non ha ancora attivato l\'accesso</span>' : ''}</td>
      <td data-label="Ruoli">${u.roles.length ? u.roles.map(r => `<span class="role-chip ${r}">${ROLE_LABEL[r]}</span>`).join(' ')
        : '<span class="muted small">nessun ruolo: non può entrare</span>'}</td>
      <td class="small" data-label="Ultimo accesso">${u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : 'mai'}</td>
      <td class="act">
        <button class="btn small ghost" data-user="edit" data-id="${u.id}">Ruoli</button>
        ${u.id === me.id ? '' : `<button class="btn small ghost" data-user="link" data-id="${u.id}"
          title="Crea un nuovo link con cui l'utente sceglie la password">${u.pending ? 'Nuovo link di attivazione' : 'Link nuova password'}</button>`}
        <button class="btn small ghost" data-user="password" data-id="${u.id}" title="Imposta tu una password">Password</button>
        ${u.id === me.id ? '' : `<button class="btn small danger ghost" data-user="delete" data-id="${u.id}">Elimina</button>`}
      </td></tr>`).join('')}</tbody></table>`;
}

function openUserDialog(mode, user = null) {
  userDialogMode = { mode, user };
  const f = $('user-form');
  f.reset();
  msg($('user-form-msg'), '');
  $('user-title').textContent = { create: 'Nuovo utente', edit: 'Nome e ruoli', password: 'Nuova password' }[mode]
    + (user ? ` · ${user.email}` : '');
  f.name.value = user?.name ?? '';
  f.email.value = user?.email ?? '';
  f.email.disabled = mode !== 'create';
  f.name.closest('label').hidden = mode === 'password';
  f.email.closest('label').hidden = mode === 'password';
  $('user-pw-label').hidden = mode === 'edit';
  // alla creazione la password è facoltativa: senza, parte l'invito via email
  f.password.required = mode === 'password';
  $('user-pw-text').textContent = mode === 'create'
    ? 'Password (facoltativa): lasciala vuota per ottenere un link di attivazione da inoltrare all\'utente'
    : 'Nuova password (almeno 8 caratteri)';
  f.querySelector('.roles').hidden = mode === 'password';
  f.querySelectorAll('[name=roles]').forEach(cb => { cb.checked = user?.roles.includes(cb.value) ?? false; });
  $('user-dialog').showModal();
}

$('new-user').onclick = () => openUserDialog('create');
$('user-cancel').onclick = () => $('user-dialog').close();

$('user-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const { mode, user } = userDialogMode;
  const roles = [...f.querySelectorAll('[name=roles]:checked')].map(cb => cb.value);
  let created = null;
  try {
    if (mode === 'create') {
      created = await callUsers({ action: 'create', email: f.email.value, password: f.password.value, name: f.name.value,
        roles, redirect_to: adminUrl() });
    } else if (mode === 'edit') {
      await callUsers({ action: 'update', user_id: user.id, name: f.name.value, roles });
    } else {
      await callUsers({ action: 'set_password', user_id: user.id, password: f.password.value });
    }
  } catch (err) {
    return msg($('user-form-msg'), err.message);
  }
  $('user-dialog').close();
  const email = f.email.value;
  await renderUsers().catch(showError);
  if (created?.link) return showUserLink(email, created.link, 'invite');
  msg($('user-msg'), mode === 'create'
    ? `Utente creato. Comunica a ${email} la password iniziale: potrà cambiarla da "Cambia password".`
    : 'Salvato.', 'ok');
});

// pagina a cui riportano i link di attivazione e di nuova password
const adminUrl = () => location.origin + location.pathname;

// il link non viene salvato né spedito: lo inoltra l'amministratore
function showUserLink(email, link, kind) {
  const intro = kind === 'invite'
    ? `Utente creato. Manda a ${email} questo link di attivazione: aprendolo sceglierà la sua password.`
    : `Manda a ${email} questo link: aprendolo sceglierà una nuova password.`;
  const text = `Ciao, ecco il link per ${kind === 'invite' ? 'attivare il tuo accesso' : 'scegliere una nuova password'} `
    + `all'area riservata: ${link}`;
  $('user-msg').innerHTML = `<div class="link-box">
    <div>${esc(intro)}</div>
    <code>${esc(link)}</code>
    <div class="small muted">Il link si può usare una sola volta e scade dopo circa un'ora: se scade, creane uno nuovo dall'elenco.</div>
    <div class="btns">
      <button type="button" class="btn small" id="user-link-copy">Copia link</button>
      <a class="btn small ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
      <a class="btn small ghost" href="mailto:${esc(email)}?subject=${encodeURIComponent('Accesso area riservata')}&body=${encodeURIComponent(text)}">Email</a>
    </div></div>`;
  $('user-link-copy').onclick = async () => {
    await navigator.clipboard.writeText(link);
    $('user-link-copy').textContent = 'Copiato ✓';
  };
}

$('user-list').addEventListener('click', async e => {
  const btn = e.target.closest('[data-user]');
  if (!btn) return;
  const user = users.find(u => u.id === btn.dataset.id);
  if (btn.dataset.user === 'link') {
    btn.disabled = true;
    try {
      const { link } = await callUsers({ action: 'new_link', user_id: user.id, redirect_to: adminUrl() });
      showUserLink(user.email, link, 'recovery');
    } catch (err) {
      msg($('user-msg'), err.message);
    }
    btn.disabled = false;
    return;
  }
  if (btn.dataset.user !== 'delete') return openUserDialog(btn.dataset.user, user);
  if (!confirm(`Eliminare l'utente ${user.email}? Non potrà più entrare nell'area riservata.`)) return;
  try {
    await callUsers({ action: 'delete', user_id: user.id });
  } catch (err) {
    return msg($('user-msg'), err.message);
  }
  await renderUsers().catch(showError);
  msg($('user-msg'), 'Utente eliminato.', 'ok');
});

// ---------------------------------------------------------------------
// Password: cambio dall'area riservata e recupero via email
// ---------------------------------------------------------------------
const PW_ERRORS = {
  same_password: 'La nuova password deve essere diversa da quella attuale.',
  weak_password: 'Password troppo debole: usa almeno 8 caratteri, con lettere e numeri.',
  over_email_send_rate_limit: 'Troppe email inviate di recente: riprova tra un\'ora.',
};

// mode: 'change' dal pulsante, 'recovery' dal link "password dimenticata", 'invite' dal link d'invito
function openPasswordDialog(mode) {
  $('pw-form').reset();
  msg($('pw-msg'), '');
  $('pw-title').textContent = { change: 'Cambia password', recovery: 'Scegli una nuova password', invite: 'Benvenuto!' }[mode];
  $('pw-hint').textContent = {
    change: 'Scegli una password di almeno 8 caratteri.',
    recovery: 'Hai aperto il link di recupero: imposta la nuova password per entrare.',
    invite: 'Sei stato invitato nell\'area riservata: scegli la password (almeno 8 caratteri) che userai per entrare.',
  }[mode];
  $('pw-cancel').hidden = mode === 'invite';
  $('pw-dialog').showModal();
}

$('change-pw').onclick = () => openPasswordDialog('change');
$('pw-cancel').onclick = () => $('pw-dialog').close();

$('pw-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.password.value !== f.confirm.value) return msg($('pw-msg'), 'Le due password non coincidono.');
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  if (error) return msg($('pw-msg'), PW_ERRORS[error.code] ?? error.message);
  msg($('pw-msg'), 'Password aggiornata.', 'ok');
  setTimeout(() => $('pw-dialog').close(), 1200);
});

$('forgot').onclick = async () => {
  const email = $('login-form').email.value.trim();
  if (!email) return msg($('login-msg'), 'Scrivi la tua email qui sopra, poi clicca di nuovo "Password dimenticata?".');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) return msg($('login-msg'), PW_ERRORS[error.code] ?? error.message);
  msg($('login-msg'), 'Se l\'email è registrata, a breve riceverai un link per scegliere una nuova password.', 'ok');
};

let started = false;
async function onSession(session) {
  if (!session) { started = false; showView('login-view'); return; }
  if (started) return;
  // sessione rimasta salvata nel browser (es. dal giorno prima) ma inattiva da più di 30 minuti
  if (sessionExpired()) { await expireSession(); return; }
  touchActivity(true);
  const { data: staff, error } = await sb.from('staff').select('name, roles').eq('user_id', session.user.id).maybeSingle();
  if (error || !staff?.roles?.length) {
    $('msg-card').innerHTML = `<h1>Accesso non autorizzato</h1>
      <p>Il tuo utente non ha ruoli nell'area riservata: chiedi a un amministratore di abilitarti.</p>
      <p class="small muted">Primo accesso? Esegui nel SQL Editor di Supabase:<br>
      <code>insert into staff(user_id, email, roles) values ('${esc(session.user.id)}', '${esc(session.user.email ?? '')}', '{admin}');</code></p>
      <button class="btn" id="msg-logout">Esci</button>`;
    $('msg-logout').onclick = () => sb.auth.signOut();
    showView('msg-view');
    return;
  }
  started = true;
  me = { id: session.user.id, email: session.user.email ?? '', roles: staff.roles };
  $('me-label').textContent = staff.name || me.email;
  document.querySelectorAll('#tabs button').forEach(b => { b.hidden = !tabAllowed(b); });
  $('new-room').hidden = !can('camere');
  $('new-booking').hidden = !can('prenotazioni');
  showView('app-view');
  await loadRooms();
  refreshBadge();
  const allowed = [...document.querySelectorAll('#tabs button')].filter(tabAllowed).map(b => b.dataset.tab);
  let tab = allowed[0];
  try {
    const saved = localStorage.getItem('admin-tab');
    if (allowed.includes(saved)) tab = saved;
  } catch { /* storage non disponibile */ }
  openTab(tab);
}

if (!configured) {
  $('msg-card').innerHTML = `<h1>Da configurare</h1>
    <p>Inserisci URL e chiave del progetto Supabase in <code>js/config.js</code> (vedi README).</p>`;
  showView('msg-view');
} else {
  sb.auth.onAuthStateChange((event, session) => {
    // arrivo da un link email (invito o nuova password): è un accesso appena fatto
    if (session && window.__authLinkType) touchActivity(true);
    setTimeout(() => {
      onSession(session).catch(showError);
      const invited = session && window.__authLinkType === 'invite';
      if (event === 'PASSWORD_RECOVERY' || invited) {
        // toglie il token dalla barra degli indirizzi e chiede subito la password
        window.__authLinkType = '';
        history.replaceState(null, '', location.pathname);
        openPasswordDialog(invited ? 'invite' : 'recovery');
      }
    }, 0);
  });
}
