// Termini e condizioni / Regolamento: testi modificabili dall'area riservata ("Sito e pagamenti")
import { configured, esc, paragraphs, loadContent, notConfiguredMessage } from './common.js';

const page = document.body.dataset.legal; // 'termini' | 'regolamento'

function fmtVersion(v) {
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return isNaN(d) ? v : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

if (!configured) {
  notConfiguredMessage(document.getElementById('config-msg'));
} else {
  loadContent().then(c => {
    document.querySelectorAll('[data-c]').forEach(el => { el.textContent = c[el.dataset.c] || ''; });
    document.getElementById('legal-version').textContent = fmtVersion(c.termini_versione || '');
    document.getElementById('legal-text').innerHTML = paragraphs(c[page]) || '<p class="muted">Testo non ancora inserito.</p>';
    const cancel = document.getElementById('cancel-text');
    if (cancel) cancel.innerHTML = paragraphs(c.condizioni_cancellazione) || '<p class="muted">Contattaci per le condizioni di cancellazione.</p>';
  }).catch(err => {
    document.getElementById('config-msg').innerHTML = `<div class="notice">${esc(err.message)}</div>`;
  });
}
