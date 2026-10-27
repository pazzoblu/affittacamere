import { createClient } from './vendor/supabase-js-2.45.4.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT');
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Colonne alloggio leggibili dalla vetrina (il token iCal resta privato)
export const ROOM_PUBLIC_COLS =
  'id, slug, name, short_description, description, capacity, price_from, price_weekend, min_nights, amenities, sort_order, published, cin, cir, discount_week, discount_month';

// Sconti per soggiorni lunghi in breve, es. "−15% da 7 notti · −30% da 28 notti" ('' se non ce ne sono)
export function discountText(r) {
  const pct = n => `−${Number(n).toLocaleString('it-IT')}%`;
  return [Number(r.discount_week) > 0 && `${pct(r.discount_week)} da 7 notti`,
    Number(r.discount_month) > 0 && `${pct(r.discount_month)} da 28 notti`].filter(Boolean).join(' · ');
}

// Messaggio leggibile da un errore di sb.functions.invoke (il corpo JSON contiene { error })
export async function functionError(error) {
  try {
    const body = await error.context.json();
    if (body?.error) return body.error;
  } catch { /* corpo non JSON */ }
  return error.message;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Testo semplice -> paragrafi HTML (righe vuote separano i paragrafi)
export function paragraphs(text) {
  return String(text ?? '').split(/\n\s*\n/).filter(p => p.trim())
    .map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

export function photoUrl(path) {
  if (!path) return '';
  return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

export function euro(n) {
  return n == null ? '' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

// Date come stringhe 'YYYY-MM-DD' in ora locale (niente sorprese di fuso orario)
export function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function nightsBetween(a, b) {
  return Math.round((parseIso(b) - parseIso(a)) / 86400000);
}
export function fmtDate(s) {
  return parseIso(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export async function loadContent() {
  const { data, error } = await sb.from('site_content').select('key, value');
  if (error) throw error;
  return Object.fromEntries(data.map(r => [r.key, r.value]));
}

export function notConfiguredMessage(el) {
  el.innerHTML = `<div class="notice">Sito non ancora configurato: inserisci URL e chiave
    del progetto Supabase in <code>js/config.js</code> (vedi README).</div>`;
}
