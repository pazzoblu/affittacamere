-- =====================================================================
-- Sincronizzazione automatica dei calendari ogni 20 minuti.
-- Prima di eseguirlo sostituisci:
--   YOUR-PROJECT  -> il riferimento del progetto (es. abcdefghijkl)
--   YOUR-SECRET   -> lo stesso valore impostato con: npx supabase secrets set CRON_SECRET=...
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ical-import') where exists (select 1 from cron.job where jobname = 'ical-import');

select cron.schedule('ical-import', '*/20 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/ical-import',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
