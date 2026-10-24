import { sb, configured, esc, paragraphs, photoUrl, euro, loadContent, notConfiguredMessage, ROOM_PUBLIC_COLS } from './common.js';

document.getElementById('year').textContent = new Date().getFullYear();

function applyContent(c) {
  document.querySelectorAll('[data-c]').forEach(el => { el.textContent = c[el.dataset.c] || ''; });
  if (c.titolo) document.title = c.titolo;
  if (c.hero_image) {
    document.getElementById('hero').style.backgroundImage = `url("${photoUrl(c.hero_image)}")`;
  }
  document.getElementById('chi-siamo-text').innerHTML = paragraphs(c.chi_siamo);

  const items = [];
  if (c.indirizzo) {
    const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.indirizzo);
    items.push(['Indirizzo', `<a href="${maps}" target="_blank" rel="noopener">${esc(c.indirizzo)}</a>`]);
  }
  if (c.telefono) items.push(['Telefono', `<a href="tel:${esc(c.telefono.replace(/\s/g, ''))}">${esc(c.telefono)}</a>`]);
  if (c.whatsapp) {
    const num = c.whatsapp.replace(/[^\d]/g, '');
    items.push(['WhatsApp', `<a href="https://wa.me/${num}" target="_blank" rel="noopener">Scrivici su WhatsApp</a>`]);
  }
  if (c.email) items.push(['Email', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`]);
  document.getElementById('contacts').innerHTML = items.length
    ? items.map(([l, v]) => `<div class="contact"><div class="lbl">${l}</div>${v}</div>`).join('')
    : '<p class="empty">Contatti non ancora inseriti.</p>';
}

async function loadRooms() {
  const { data: rooms, error } = await sb.from('rooms')
    .select(`${ROOM_PUBLIC_COLS}, room_photos(path, sort_order)`)
    .eq('published', true)
    .order('sort_order').order('name');
  if (error) throw error;

  const el = document.getElementById('rooms');
  if (!rooms.length) { el.innerHTML = '<p class="empty">Nessuna camera pubblicata.</p>'; return; }
  el.innerHTML = rooms.map(r => {
    const first = [...r.room_photos].sort((a, b) => a.sort_order - b.sort_order)[0];
    const bg = first ? `style="background-image:url('${photoUrl(first.path)}')"` : '';
    return `
      <a class="room-card" href="camera.html?c=${encodeURIComponent(r.slug)}">
        <div class="ph" ${bg}></div>
        <div class="body">
          <h3>${esc(r.name)}</h3>
          <p>${esc(r.short_description)}</p>
          <div class="meta">
            <span>👤 fino a ${r.capacity} ${r.capacity === 1 ? 'ospite' : 'ospiti'}</span>
            ${r.price_from != null ? `<span class="price">da <strong>${euro(r.price_from)}</strong>/notte</span>` : ''}
          </div>
        </div>
      </a>`;
  }).join('');
}

if (!configured) {
  notConfiguredMessage(document.getElementById('config-msg'));
} else {
  Promise.all([loadContent().then(applyContent), loadRooms()]).catch(err => {
    console.error(err);
    document.getElementById('config-msg').innerHTML =
      `<div class="notice">Errore nel caricamento dei dati: ${esc(err.message)}</div>`;
  });
}
