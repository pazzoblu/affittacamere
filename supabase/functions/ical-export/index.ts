// Pubblica il calendario di una camera in formato iCal, da incollare su Booking/Airbnb.
// URL: /functions/v1/ical-export?room=<ical_token>[&exclude=<id calendario importato>]
// "exclude" toglie le prenotazioni arrivate proprio da quel portale, così non gli vengono rimandate indietro.
// Non contiene dati degli ospiti: solo i periodi occupati.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { buildIcs } from '../_shared/ical.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async req => {
  const url = new URL(req.url);
  const token = url.searchParams.get('room') ?? '';
  const exclude = url.searchParams.get('exclude');
  if (!UUID.test(token) || (exclude && !UUID.test(exclude))) return new Response('Parametri non validi', { status: 400 });

  const { data: room } = await db.from('rooms').select('id, name').eq('ical_token', token).maybeSingle();
  if (!room) return new Response('Calendario non trovato', { status: 404 });

  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  let q = db.from('bookings').select('id, check_in, check_out')
    .eq('room_id', room.id).eq('status', 'confermata').gte('check_out', since).order('check_in');
  if (exclude) q = q.or(`ical_source_id.is.null,ical_source_id.neq.${exclude}`);
  const { data: bookings, error } = await q;
  if (error) return new Response('Errore', { status: 500 });

  const ics = buildIcs(room.name, (bookings ?? []).map(b => ({
    uid: `${b.id}@affittacamere`,
    start: b.check_in,
    end: b.check_out,
    summary: 'Non disponibile',
  })));

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="calendario.ics"',
      'Cache-Control': 'no-cache',
    },
  });
});
