import { sb, configured, esc, euro, fmtDate, loadContent, notConfiguredMessage } from './common.js';

const params = new URLSearchParams(location.search);
const bookingId = params.get('b');
const ok = params.get('esito') === 'ok';
const isLink = params.get('tipo') === 'link';
const box = document.getElementById('result');

function show(icon, title, html) {
  box.innerHTML = `<div class="icon">${icon}</div><h1>${esc(title)}</h1>${html}`;
}

const homeBtn = '<p><a class="btn" href="./">Torna al sito</a></p>';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function confirmed() {
  // il webhook di Stripe arriva di solito entro pochi secondi
  for (let i = 0; i < 10; i++) {
    const { data } = await sb.rpc('booking_public_status', { p_id: bookingId });
    const b = data?.[0];
    if (!b) return show('✅', 'Pagamento ricevuto', '<p>Grazie! Riceverai la ricevuta via email.</p>' + homeBtn);
    if (b.status === 'confermata') {
      const rest = Number(b.price ?? 0) - Number(b.amount_paid);
      return show('🎉', 'Prenotazione confermata!', `
        <p><strong>${esc(b.room_name)}</strong><br>${fmtDate(b.check_in)} → ${fmtDate(b.check_out)}</p>
        <p>Hai pagato <strong>${euro(b.amount_paid)}</strong>${rest > 0.009
          ? `; il saldo di <strong>${euro(rest)}</strong> si paga all'arrivo.` : ': il soggiorno è saldato.'}</p>
        <p>Riceverai la ricevuta del pagamento via email. A presto!</p>` + homeBtn);
    }
    if (b.status === 'annullata') break;
    await sleep(2000);
  }
  show('⏳', 'Pagamento in verifica', `<p>Il pagamento è stato inviato ma non abbiamo ancora ricevuto la conferma.
    Se l'importo ti è stato addebitato non preoccuparti: la prenotazione verrà confermata e ti contatteremo noi.</p>` + homeBtn);
}

async function cancelled() {
  const { data } = await sb.rpc('booking_public_status', { p_id: bookingId });
  await sb.functions.invoke('payments', { body: { action: 'cancel', booking_id: bookingId } });
  const back = data?.[0]?.room_slug ? `camera.html?c=${encodeURIComponent(data[0].room_slug)}` : './';
  show('↩️', 'Pagamento annullato', `<p>Non ti è stato addebitato nulla e le date sono di nuovo libere.</p>
    <p><a class="btn" href="${back}">Riprova</a></p>`);
}

async function init() {
  const content = await loadContent();
  document.querySelectorAll('[data-c]').forEach(el => { el.textContent = content[el.dataset.c] || ''; });
  if (isLink || !bookingId) {
    return ok
      ? show('✅', 'Pagamento ricevuto', '<p>Grazie! Riceverai la ricevuta via email.</p>' + homeBtn)
      : show('↩️', 'Pagamento non completato', '<p>Non ti è stato addebitato nulla. Puoi riaprire il link che hai ricevuto entro la sua scadenza.</p>' + homeBtn);
  }
  return ok ? confirmed() : cancelled();
}

if (!configured) {
  box.hidden = true;
  notConfiguredMessage(document.getElementById('config-msg'));
} else {
  init().catch(err => show('⚠️', 'Errore', `<p>${esc(err.message)}</p>` + homeBtn));
}
