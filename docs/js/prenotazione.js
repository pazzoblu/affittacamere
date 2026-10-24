import { sb, configured, esc, euro, fmtDate, nightsBetween, loadContent, notConfiguredMessage } from './common.js';

document.getElementById('year').textContent = new Date().getFullYear();
const $ = id => document.getElementById(id);

const STATUS = {
  richiesta: ['In attesa di conferma', 'wait'],
  confermata: ['Confermata', 'ok'],
  annullata: ['Annullata', 'off'],
};
let current = null; // { code, email }
let content = {};

function msg(el, text, kind = 'err') {
  el.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : '';
}

function render(b) {
  const [label, cls] = STATUS[b.status];
  $('b-code').textContent = b.code;
  $('b-room').textContent = b.room_name;
  const n = nightsBetween(b.check_in, b.check_out);
  $('b-dates').textContent = `${fmtDate(b.check_in)} → ${fmtDate(b.check_out)} · ${n} ${n === 1 ? 'notte' : 'notti'}`;
  $('b-status').textContent = label;
  $('b-status').className = `status-pill ${cls}`;

  const facts = [];
  if (b.guests) facts.push(['Ospiti', b.guests]);
  if (b.price != null) facts.push(['Totale soggiorno', euro(b.price)]);
  if (Number(b.amount_paid) > 0) {
    facts.push(['Già pagato', euro(b.amount_paid)]);
    const rest = Number(b.price ?? 0) - Number(b.amount_paid);
    if (rest > 0.009) facts.push(['Da pagare all\'arrivo', euro(rest)]);
  }
  $('b-facts').innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  const started = b.check_in < new Date().toISOString().slice(0, 10);
  const requested = !!b.cancel_requested_at;
  $('b-cancel-info').innerHTML = requested && b.status !== 'annullata'
    ? `<div class="msg ok">Hai richiesto la cancellazione il ${new Date(b.cancel_requested_at).toLocaleDateString('it-IT')}:
       la struttura ti risponderà via email.</div>` : '';
  $('cancel-box').hidden = b.status === 'annullata' || started || requested;
  $('cancel-terms').textContent = content.condizioni_cancellazione || '';
  $('booking').hidden = false;
}

async function lookup(code, email) {
  const { data, error } = await sb.rpc('booking_lookup', { p_code: code, p_email: email });
  if (error) throw error;
  return data[0] ?? null;
}

$('lookup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  msg($('lookup-msg'), '');
  $('booking').hidden = true;
  const b = await lookup(f.code.value, f.email.value).catch(err => { msg($('lookup-msg'), err.message); });
  if (b === undefined) return;
  if (!b) return msg($('lookup-msg'), 'Nessuna prenotazione trovata: controlla il codice e l\'email.');
  current = { code: b.code, email: f.email.value };
  render(b);
});

$('message-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const { error } = await sb.rpc('send_guest_message', { p_code: current.code, p_email: current.email, p_message: f.message.value });
  if (error) return msg($('message-msg'), error.message);
  f.reset();
  msg($('message-msg'), 'Messaggio inviato: ti risponderemo via email.', 'ok');
});

$('cancel-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!confirm('Vuoi davvero chiedere la cancellazione della prenotazione?')) return;
  const f = e.target;
  const { error } = await sb.rpc('request_cancellation', { p_code: current.code, p_email: current.email, p_message: f.message.value });
  if (error) return msg($('cancel-msg'), error.message);
  f.reset();
  render(await lookup(current.code, current.email));
});

if (!configured) {
  notConfiguredMessage($('config-msg'));
} else {
  loadContent().then(c => {
    content = c;
    document.querySelectorAll('[data-c]').forEach(el => { el.textContent = c[el.dataset.c] || ''; });
  }).catch(err => msg($('config-msg'), err.message));
  const code = new URLSearchParams(location.search).get('c');
  if (code) $('lookup-form').code.value = code;
}
