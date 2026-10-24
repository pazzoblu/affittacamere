import { configured, esc, loadContent, notConfiguredMessage } from './common.js';

document.getElementById('year').textContent = new Date().getFullYear();

// I dati del titolare arrivano da "Sito e pagamenti" nell'area riservata
function fill(c) {
  document.querySelectorAll('[data-c]').forEach(el => { el.textContent = c[el.dataset.c] || ''; });
  const values = { ...c, titolare: c.titolare || c.titolo };
  document.querySelectorAll('[data-p]').forEach(el => {
    const v = values[el.dataset.p];
    if (!v) {
      // il titolare deve sempre esserci: lo si segnala invece di lasciare un buco
      el.innerHTML = el.dataset.p === 'titolare' || el.dataset.p === 'email'
        ? '<mark>[da completare nell\'area riservata]</mark>' : '';
      return;
    }
    const text = esc(v);
    const body = el.dataset.link === 'mailto' ? `<a href="mailto:${text}">${text}</a>` : text;
    el.innerHTML = esc(el.dataset.prefix || '') + body;
  });
}

if (!configured) {
  notConfiguredMessage(document.getElementById('config-msg'));
} else {
  loadContent().then(fill).catch(err => {
    document.getElementById('config-msg').innerHTML = `<div class="notice">${esc(err.message)}</div>`;
  });
}
