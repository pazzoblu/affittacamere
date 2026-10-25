import {
  sb, configured, esc, paragraphs, photoUrl, euro, loadContent, notConfiguredMessage, ROOM_PUBLIC_COLS, discountText,
} from './common.js';

document.getElementById('year').textContent = new Date().getFullYear();

function applyContent(c) {
  document.querySelectorAll('[data-c]').forEach(el => { el.textContent = c[el.dataset.c] || ''; });
  if (c.titolo) document.title = c.titolo;
  if (c.hero_image) {
    const img = document.getElementById('hero-img');
    img.src = photoUrl(c.hero_image);
    img.alt = `${c.titolo || 'La struttura'}: foto di copertina`;
    img.hidden = false;
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
    .select(`${ROOM_PUBLIC_COLS}, room_photos(path, caption, sort_order)`)
    .eq('published', true)
    .order('sort_order').order('name');
  if (error) throw error;

  const el = document.getElementById('rooms');
  if (!rooms.length) { el.innerHTML = '<p class="empty">Nessun alloggio pubblicato.</p>'; return; }

  const coverOf = r => [...r.room_photos].sort((a, b) => a.sort_order - b.sort_order)[0];
  const guests = r => `👤 fino a ${r.capacity} ${r.capacity === 1 ? 'ospite' : 'ospiti'}`;
  const link = r => `camera.html?c=${encodeURIComponent(r.slug)}`;
  // immagine con testo alternativo (didascalia della foto, altrimenti il nome dell'alloggio)
  const photo = r => {
    const c = coverOf(r);
    return c ? `<img src="${photoUrl(c.path)}" alt="${esc(c.caption || `Foto di ${r.name}`)}" loading="lazy">` : '';
  };
  const bigPrice = r => r.price_from == null ? '' : `
    <div class="big-price"><span>da</span> <strong>${euro(r.price_from)}</strong> <span>a notte</span></div>`;

  // prezzo e pulsante principale anche nella copertina
  const prices = rooms.map(r => r.price_from).filter(p => p != null).map(Number);
  const heroPrice = document.getElementById('hero-price');
  if (prices.length) {
    const disc = rooms.length === 1 ? discountText(rooms[0]) : '';
    heroPrice.innerHTML = `da <strong>${euro(Math.min(...prices))}</strong> a notte${disc ? ` · ${esc(disc)}` : ''}`;
    heroPrice.hidden = false;
  }

  // con una sola casa la home la presenta per intero; con più case mostra l'elenco
  if (rooms.length === 1) {
    const r = rooms[0];
    document.getElementById('hero-cta').href = `${link(r)}#prenota`;
    el.innerHTML = `
      <div class="feature">
        <a class="feature-ph" href="${link(r)}" aria-label="Tutte le foto di ${esc(r.name)}">${photo(r)}</a>
        <div class="feature-body">
          <h3>${esc(r.name)}</h3>
          ${r.short_description ? `<p class="lead">${esc(r.short_description)}</p>` : ''}
          ${bigPrice(r)}
          ${discountText(r) ? `<div><span class="feature-discounts">Soggiorni lunghi: ${esc(discountText(r))}</span></div>` : ''}
          <div class="meta"><span>${guests(r)}${r.min_nights > 1 ? ` · minimo ${r.min_nights} notti` : ''}</span></div>
          ${r.amenities.length ? `<ul class="chips">${r.amenities.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          <div class="feature-actions">
            <a class="btn btn-lg" href="${link(r)}#prenota">Verifica disponibilità</a>
            <a class="btn ghost" href="${link(r)}">Guarda tutte le foto</a>
          </div>
        </div>
      </div>`;
    return;
  }

  document.getElementById('rooms-title').textContent = 'I nostri alloggi';
  document.getElementById('rooms-subtitle').textContent = 'Scegli la casa e verifica la disponibilità';
  document.getElementById('hero-more').textContent = 'Scopri gli alloggi';
  document.querySelectorAll('.site-nav a[href="#alloggio"]').forEach(a => { a.textContent = 'Gli alloggi'; });
  el.className = 'rooms';
  el.innerHTML = rooms.map(r => `
      <a class="room-card" href="${link(r)}#prenota">
        <div class="ph">${photo(r)}</div>
        <div class="body">
          <h3>${esc(r.name)}</h3>
          <p>${esc(r.short_description)}</p>
          ${bigPrice(r)}
          <div class="meta">
            <span>${guests(r)}${discountText(r) ? `<br><span class="discount-tag">${esc(discountText(r))}</span>` : ''}</span>
          </div>
          <span class="btn card-cta">Verifica disponibilità</span>
        </div>
      </a>`).join('');
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
