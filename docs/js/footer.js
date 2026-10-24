// Riga legale in fondo alle pagine pubbliche: gestore e codici identificativi (CIN/CIR) degli alloggi
import { sb, configured, esc, loadContent } from './common.js';

async function fillLegalLine() {
  const el = document.getElementById('legal-line');
  if (!el || !configured) return;
  const [c, { data: rooms }] = await Promise.all([
    loadContent(),
    sb.from('rooms').select('name, cin, cir').eq('published', true).order('sort_order').order('name'),
  ]);
  const parts = [];
  const gestore = c.titolare || c.titolo;
  if (gestore) parts.push(`Gestore: ${esc(gestore)}${c.indirizzo ? ` · ${esc(c.indirizzo)}` : ''}`);
  const codes = (rooms ?? []).filter(r => r.cin || r.cir).map(r => {
    const code = [r.cin && `CIN ${esc(r.cin)}`, r.cir && `CIR ${esc(r.cir)}`].filter(Boolean).join(' · ');
    return rooms.length > 1 ? `${esc(r.name)}: ${code}` : code;
  });
  parts.push(...codes);
  el.innerHTML = parts.join('<span class="sep"> | </span>');
}

const year = document.getElementById('year');
if (year && !year.textContent) year.textContent = new Date().getFullYear();
fillLegalLine().catch(err => console.error(err));
