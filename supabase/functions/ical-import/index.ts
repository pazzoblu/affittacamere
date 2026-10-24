// Importa i calendari iCal dei portali (Booking, Airbnb, ...) come prenotazioni bloccanti.
// Chiamata dal pulsante "Sincronizza ora" dell'area admin (utente admin)
// oppure dal cron del database con l'header x-cron-secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { parseIcs } from '../_shared/ical.ts';
import { isAdminRequest } from '../_shared/admin.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') === secret) return true;
  return isAdminRequest(db, req);
}

async function syncSource(src: { id: string; room_id: string; channel: string; url: string }) {
  const res = await fetch(src.url, {
    headers: { 'User-Agent': 'AffittaCamere-iCal-Sync/1.0', Accept: 'text/calendar, */*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`il portale ha risposto ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('il link non restituisce un calendario iCal');

  const today = new Date().toISOString().slice(0, 10);
  // le prenotazioni già concluse restano come storico, si sincronizzano solo quelle attuali e future
  const events = parseIcs(text).filter(e => e.end >= today);

  if (events.length) {
    const { error } = await db.from('bookings').upsert(
      events.map(e => ({
        room_id: src.room_id,
        check_in: e.start,
        check_out: e.end,
        status: 'confermata',
        source: src.channel,
        ical_source_id: src.id,
        external_uid: e.uid,
      })),
      { onConflict: 'ical_source_id,external_uid' },
    );
    if (error) throw new Error(error.message);
  }

  // ciò che non è più nel feed è stato cancellato sul portale
  const { data: existing, error: selErr } = await db.from('bookings')
    .select('id, external_uid').eq('ical_source_id', src.id).gte('check_out', today);
  if (selErr) throw new Error(selErr.message);
  const uids = new Set(events.map(e => e.uid));
  const stale = (existing ?? []).filter(b => !uids.has(b.external_uid)).map(b => b.id);
  if (stale.length) {
    const { error } = await db.from('bookings').delete().in('id', stale);
    if (error) throw new Error(error.message);
  }
  return { events: events.length, removed: stale.length };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await authorized(req))) return json({ error: 'non autorizzato' }, 401);

  let body: { source_id?: string } = {};
  try { body = await req.json(); } catch { /* corpo vuoto */ }

  let q = db.from('ical_sources').select('id, room_id, channel, name, url');
  if (body.source_id) q = q.eq('id', body.source_id);
  const { data: sources, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const src of sources ?? []) {
    try {
      const r = await syncSource(src);
      await db.from('ical_sources').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('id', src.id);
      results.push({ id: src.id, name: src.name, ...r });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.from('ical_sources').update({ last_sync_at: new Date().toISOString(), last_error: message }).eq('id', src.id);
      results.push({ id: src.id, name: src.name, events: 0, removed: 0, error: message });
    }
  }
  return json({ results });
});
