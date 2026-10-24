-- =====================================================================
-- AffittaCamere - schema database Supabase
-- Da eseguire in Supabase > SQL Editor. È rieseguibile: dopo un aggiornamento
-- del progetto basta rieseguirlo per aggiungere tabelle e colonne nuove.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Amministratori: solo gli utenti presenti qui possono gestire il sito
-- ---------------------------------------------------------------------
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Camere
-- ---------------------------------------------------------------------
create table if not exists rooms (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  short_description text not null default '',
  description       text not null default '',
  capacity          int  not null default 2 check (capacity > 0),
  price_from        numeric(10,2),  -- prezzo base a notte
  amenities         text[] not null default '{}',
  sort_order        int  not null default 0,
  published         boolean not null default true,
  -- token segreto usato nel link iCal di esportazione
  ical_token        uuid not null default gen_random_uuid() unique,
  created_at        timestamptz not null default now()
);
alter table rooms add column if not exists price_weekend numeric(10,2);  -- notti di venerdì e sabato
alter table rooms add column if not exists min_nights int not null default 1;

create table if not exists room_photos (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  path       text not null,          -- percorso nel bucket "photos"
  caption    text not null default '',
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists room_photos_room_idx on room_photos(room_id, sort_order);

-- Prezzi stagionali: valgono per le notti da date_from a date_to (inclusi)
create table if not exists season_prices (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  name          text not null default '',
  date_from     date not null,
  date_to       date not null,
  price_night   numeric(10,2) not null check (price_night >= 0),
  price_weekend numeric(10,2) check (price_weekend >= 0),
  created_at    timestamptz not null default now(),
  constraint season_dates_chk check (date_to >= date_from)
);
create index if not exists season_prices_room_idx on season_prices(room_id, date_from);

-- ---------------------------------------------------------------------
-- Testi e impostazioni della vetrina (chiave/valore, leggibili da tutti)
-- ---------------------------------------------------------------------
create table if not exists site_content (
  key   text primary key,
  value text not null default ''
);

insert into site_content(key, value) values
  ('titolo',      'Il mio Affittacamere'),
  ('sottotitolo', 'Camere accoglienti nel cuore della città'),
  ('chi_siamo',   'Scrivi qui una presentazione della tua struttura.'),
  ('indirizzo',   ''),
  ('telefono',    ''),
  ('email',       ''),
  ('whatsapp',    ''),
  ('hero_image',  ''),
  ('pagamenti_attivi',         '0'),
  ('acconto_percentuale',      '30'),
  ('condizioni_cancellazione', 'Cancellazione gratuita fino a 7 giorni prima dell''arrivo. In seguito l''acconto non è rimborsabile.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Calendari esterni (Booking, Airbnb, ...) da importare via iCal
-- ---------------------------------------------------------------------
create table if not exists ical_sources (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms(id) on delete cascade,
  channel      text not null default 'altro' check (channel in ('booking','airbnb','altro')),
  name         text not null,
  url          text not null,
  last_sync_at timestamptz,
  last_error   text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Prenotazioni (dirette, richieste dal sito, importate dai portali)
-- check_out è il giorno di partenza (escluso dal soggiorno)
-- ---------------------------------------------------------------------
create table if not exists bookings (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references rooms(id) on delete cascade,
  check_in       date not null,
  check_out      date not null,
  status         text not null default 'confermata'
                 check (status in ('richiesta','confermata','annullata')),
  source         text not null default 'diretta'
                 check (source in ('diretta','sito','booking','airbnb','altro')),
  guest_name     text not null default '',
  guest_email    text not null default '',
  guest_phone    text not null default '',
  guests         int,
  price          numeric(10,2),  -- prezzo totale del soggiorno
  notes          text not null default '',
  ical_source_id uuid references ical_sources(id) on delete cascade,
  external_uid   text,
  created_at     timestamptz not null default now(),
  constraint bookings_dates_chk check (check_out > check_in),
  constraint bookings_external_uq unique (ical_source_id, external_uid)
);
create index if not exists bookings_room_dates_idx on bookings(room_id, check_in, check_out);

-- Pagamenti: quanto è stato incassato e, per i pagamenti online in corso,
-- fino a quando le date restano bloccate in attesa che l'ospite paghi
alter table bookings add column if not exists amount_paid numeric(10,2) not null default 0;
alter table bookings add column if not exists payment_status text not null default 'nessuno';
alter table bookings add column if not exists expires_at timestamptz;
alter table bookings drop constraint if exists bookings_payment_status_chk;
alter table bookings add constraint bookings_payment_status_chk
  check (payment_status in ('nessuno','in_attesa','acconto','pagato','rimborsato'));

-- Ogni tentativo di pagamento con Stripe (online dal sito o link creato dall'admin)
create table if not exists payments (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references bookings(id) on delete cascade,
  kind                  text not null check (kind in ('acconto','totale','link')),
  amount                numeric(10,2) not null check (amount > 0),
  status                text not null default 'in_attesa'
                        check (status in ('in_attesa','pagato','scaduto','rimborsato')),
  stripe_session_id     text unique,
  stripe_payment_intent text,
  checkout_url          text,
  expires_at            timestamptz,
  created_at            timestamptz not null default now(),
  paid_at               timestamptz
);
create index if not exists payments_booking_idx on payments(booking_id);

-- ---------------------------------------------------------------------
-- Disponibilità e prezzi
-- ---------------------------------------------------------------------

-- Una camera è occupata da prenotazioni confermate e da pagamenti online in corso
create or replace function room_is_free(p_room uuid, p_check_in date, p_check_out date, p_exclude uuid default null)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from bookings
    where room_id = p_room
      and (status = 'confermata' or (status = 'richiesta' and expires_at > now()))
      and check_in < p_check_out and check_out > p_check_in
      and id is distinct from p_exclude
  );
$$;

-- Prezzo totale: per ogni notte vale la stagione che la contiene (se ce n'è più d'una,
-- quella iniziata più tardi), altrimenti il prezzo base; venerdì e sabato usano il prezzo weekend.
-- Restituisce null se manca un prezzo per qualche notte.
create or replace function quote_price(p_room uuid, p_check_in date, p_check_out date)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_room rooms%rowtype;
  v_season season_prices%rowtype;
  v_day date := p_check_in;
  v_weekend boolean;
  v_price numeric;
  v_total numeric := 0;
begin
  select * into v_room from rooms where id = p_room;
  if not found or p_check_out <= p_check_in then
    return null;
  end if;
  while v_day < p_check_out loop
    v_weekend := extract(isodow from v_day) in (5, 6);
    select * into v_season from season_prices
      where room_id = p_room and v_day between date_from and date_to
      order by date_from desc, created_at desc limit 1;
    if found then
      v_price := case when v_weekend then coalesce(v_season.price_weekend, v_season.price_night) else v_season.price_night end;
    else
      v_price := case when v_weekend then coalesce(v_room.price_weekend, v_room.price_from) else v_room.price_from end;
    end if;
    if v_price is null then
      return null;
    end if;
    v_total := v_total + v_price;
    v_day := v_day + 1;
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- Funzioni pubbliche (usate dalla vetrina, senza esporre dati ospiti)
-- ---------------------------------------------------------------------

-- Periodi occupati di una camera: solo date, nessun dato personale
create or replace function room_busy_ranges(p_room uuid, p_from date, p_to date)
returns table(check_in date, check_out date)
language sql stable security definer set search_path = public as $$
  select b.check_in, b.check_out
  from bookings b
  join rooms r on r.id = b.room_id and r.published
  where b.room_id = p_room
    and (b.status = 'confermata' or (b.status = 'richiesta' and b.expires_at > now()))
    and b.check_out > p_from
    and b.check_in  < p_to
  order by b.check_in;
$$;

-- Preventivo per la vetrina: notti, totale, acconto, se si può pagare online
create or replace function quote_booking(p_room uuid, p_check_in date, p_check_out date)
returns table(nights int, total numeric, deposit numeric, deposit_percent int,
              min_nights int, available boolean, online_payment boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_min int;
  v_pct int;
  v_total numeric;
  v_active boolean;
begin
  select r.min_nights into v_min from rooms r where r.id = p_room and r.published;
  if v_min is null then
    raise exception 'Camera non trovata';
  end if;
  select coalesce(nullif(value, '')::int, 30) into v_pct from site_content where key = 'acconto_percentuale';
  select value = '1' into v_active from site_content where key = 'pagamenti_attivi';
  v_pct := least(100, greatest(1, coalesce(v_pct, 30)));
  v_total := quote_price(p_room, p_check_in, p_check_out);
  return query select
    p_check_out - p_check_in,
    v_total,
    round(v_total * v_pct / 100.0, 2),
    v_pct,
    v_min,
    room_is_free(p_room, p_check_in, p_check_out),
    coalesce(v_active, false) and v_total is not null and v_total > 0;
end;
$$;

-- Controlli comuni a richieste e prenotazioni online
create or replace function validate_site_booking(
  p_room uuid, p_check_in date, p_check_out date,
  p_name text, p_email text, p_phone text, p_guests int
) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_room rooms%rowtype;
begin
  select * into v_room from rooms where id = p_room and published;
  if not found then
    raise exception 'Camera non trovata';
  end if;
  if p_check_in < current_date or p_check_out <= p_check_in then
    raise exception 'Date non valide';
  end if;
  if p_check_out - p_check_in > 60 then
    raise exception 'Soggiorno troppo lungo: contattaci direttamente';
  end if;
  if p_check_out - p_check_in < v_room.min_nights then
    raise exception 'Per questa camera il soggiorno minimo è di % notti', v_room.min_nights;
  end if;
  if coalesce(trim(p_name), '') = '' or (coalesce(trim(p_email), '') = '' and coalesce(trim(p_phone), '') = '') then
    raise exception 'Inserisci nome e almeno un contatto (email o telefono)';
  end if;
  if p_guests is not null and (p_guests < 1 or p_guests > v_room.capacity) then
    raise exception 'Numero ospiti non valido per questa camera (max %)', v_room.capacity;
  end if;
  if not room_is_free(p_room, p_check_in, p_check_out) then
    raise exception 'La camera non è disponibile in queste date';
  end if;
  -- limite anti-spam: max 20 richieste aperte dal sito
  if (select count(*) from bookings where source = 'sito' and status = 'richiesta') >= 20 then
    raise exception 'Troppe richieste in attesa, riprova più tardi o contattaci';
  end if;
end;
$$;

-- Richiesta di prenotazione dal sito: entra come "richiesta", la confermi tu
create or replace function request_booking(
  p_room uuid, p_check_in date, p_check_out date,
  p_name text, p_email text, p_phone text, p_guests int, p_notes text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform validate_site_booking(p_room, p_check_in, p_check_out, p_name, p_email, p_phone, p_guests);
  insert into bookings(room_id, check_in, check_out, status, source, price,
                       guest_name, guest_email, guest_phone, guests, notes)
  values (p_room, p_check_in, p_check_out, 'richiesta', 'sito', quote_price(p_room, p_check_in, p_check_out),
          left(trim(p_name), 200), left(trim(coalesce(p_email,'')), 200),
          left(trim(coalesce(p_phone,'')), 50), p_guests, left(coalesce(p_notes,''), 2000))
  returning id into v_id;
  return v_id;
end;
$$;

-- Stato di una prenotazione per la pagina di esito del pagamento (l'id è un uuid non indovinabile)
create or replace function booking_public_status(p_id uuid)
returns table(status text, payment_status text, amount_paid numeric, price numeric,
              check_in date, check_out date, room_name text, room_slug text)
language sql stable security definer set search_path = public as $$
  select b.status, b.payment_status, b.amount_paid, b.price, b.check_in, b.check_out, r.name, r.slug
  from bookings b join rooms r on r.id = b.room_id
  where b.id = p_id and b.source = 'sito';
$$;

-- ---------------------------------------------------------------------
-- Funzioni di pagamento: le chiamano solo le Edge Functions (service role)
-- ---------------------------------------------------------------------

-- Prenotazione online: blocca le date per 35 minuti in attesa del pagamento
create or replace function create_online_booking(
  p_room uuid, p_check_in date, p_check_out date,
  p_name text, p_email text, p_phone text, p_guests int, p_notes text, p_mode text
) returns table(booking_id uuid, room_name text, total numeric, amount numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_quote record;
  v_id uuid;
  v_amount numeric;
begin
  if p_mode not in ('acconto', 'totale') then
    raise exception 'Modalità di pagamento non valida';
  end if;
  if coalesce(trim(p_email), '') = '' then
    raise exception 'Per pagare online serve l''email';
  end if;
  perform validate_site_booking(p_room, p_check_in, p_check_out, p_name, p_email, p_phone, p_guests);
  select * into v_quote from quote_booking(p_room, p_check_in, p_check_out);
  if not v_quote.online_payment then
    raise exception 'Pagamento online non disponibile per queste date: invia una richiesta';
  end if;
  v_amount := case when p_mode = 'totale' then v_quote.total else v_quote.deposit end;

  insert into bookings(room_id, check_in, check_out, status, source, price, payment_status, expires_at,
                       guest_name, guest_email, guest_phone, guests, notes)
  values (p_room, p_check_in, p_check_out, 'richiesta', 'sito', v_quote.total, 'in_attesa', now() + interval '35 minutes',
          left(trim(p_name), 200), left(trim(p_email), 200),
          left(trim(coalesce(p_phone,'')), 50), p_guests, left(coalesce(p_notes,''), 2000))
  returning id into v_id;

  return query select v_id, (select name from rooms where id = p_room), v_quote.total, v_amount;
end;
$$;

-- Pagamento riuscito (webhook Stripe). Idempotente: Stripe può inviare lo stesso evento più volte.
create or replace function register_payment(p_session text, p_intent text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay payments%rowtype;
  v_b bookings%rowtype;
  v_paid numeric;
begin
  select * into v_pay from payments where stripe_session_id = p_session for update;
  if not found or v_pay.status = 'pagato' then
    return;
  end if;
  update payments set status = 'pagato', paid_at = now(), stripe_payment_intent = p_intent where id = v_pay.id;

  select * into v_b from bookings where id = v_pay.booking_id for update;
  v_paid := v_b.amount_paid + v_pay.amount;
  update bookings set
    amount_paid    = v_paid,
    payment_status = case when v_paid >= coalesce(price, 0) then 'pagato' else 'acconto' end,
    expires_at     = null,
    status = case
      when status = 'richiesta' then 'confermata'
      -- caso raro: annullata mentre l'ospite pagava; si riattiva solo se la camera è ancora libera
      when status = 'annullata' and room_is_free(room_id, check_in, check_out, id) then 'confermata'
      else status end,
    notes = case
      when status = 'annullata' and not room_is_free(room_id, check_in, check_out, id)
      then trim(notes || E'\nATTENZIONE: pagamento ricevuto su prenotazione annullata, camera non più libera: verificare o rimborsare.')
      else notes end
  where id = v_b.id;
end;
$$;

-- Pagamento scaduto o abbandonato: libera le date delle prenotazioni online non pagate
create or replace function expire_payment(p_session text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay payments%rowtype;
begin
  select * into v_pay from payments where stripe_session_id = p_session for update;
  if not found or v_pay.status <> 'in_attesa' then
    return;
  end if;
  update payments set status = 'scaduto' where id = v_pay.id;
  if v_pay.kind in ('acconto', 'totale') then
    update bookings set status = 'annullata', payment_status = 'nessuno', expires_at = null
    where id = v_pay.booking_id and status = 'richiesta' and amount_paid = 0;
  end if;
end;
$$;

revoke execute on function quote_price(uuid, date, date) from public, anon;
grant execute on function quote_price(uuid, date, date) to authenticated;  -- "calcola dai listini" nell admin
revoke execute on function room_is_free(uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function validate_site_booking(uuid, date, date, text, text, text, int) from public, anon, authenticated;
revoke execute on function create_online_booking(uuid, date, date, text, text, text, int, text, text) from public, anon, authenticated;
revoke execute on function register_payment(text, text) from public, anon, authenticated;
revoke execute on function expire_payment(text) from public, anon, authenticated;
grant execute on function room_busy_ranges(uuid, date, date) to anon, authenticated;
grant execute on function quote_booking(uuid, date, date) to anon, authenticated;
grant execute on function request_booking(uuid, date, date, text, text, text, int, text) to anon, authenticated;
grant execute on function booking_public_status(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table admins        enable row level security;
alter table rooms         enable row level security;
alter table room_photos   enable row level security;
alter table season_prices enable row level security;
alter table site_content  enable row level security;
alter table ical_sources  enable row level security;
alter table bookings      enable row level security;
alter table payments      enable row level security;

drop policy if exists admins_self on admins;
create policy admins_self on admins for select using (user_id = auth.uid());

drop policy if exists rooms_public_read on rooms;
create policy rooms_public_read on rooms for select using (published or is_admin());
drop policy if exists rooms_admin_write on rooms;
create policy rooms_admin_write on rooms for all using (is_admin()) with check (is_admin());

drop policy if exists photos_public_read on room_photos;
create policy photos_public_read on room_photos for select
  using (is_admin() or exists (select 1 from rooms r where r.id = room_id and r.published));
drop policy if exists photos_admin_write on room_photos;
create policy photos_admin_write on room_photos for all using (is_admin()) with check (is_admin());

drop policy if exists seasons_admin_all on season_prices;
create policy seasons_admin_all on season_prices for all using (is_admin()) with check (is_admin());

drop policy if exists content_public_read on site_content;
create policy content_public_read on site_content for select using (true);
drop policy if exists content_admin_write on site_content;
create policy content_admin_write on site_content for all using (is_admin()) with check (is_admin());

drop policy if exists ical_admin_all on ical_sources;
create policy ical_admin_all on ical_sources for all using (is_admin()) with check (is_admin());

drop policy if exists bookings_admin_all on bookings;
create policy bookings_admin_all on bookings for all using (is_admin()) with check (is_admin());

-- i pagamenti li scrivono solo le Edge Functions; l'admin li legge
drop policy if exists payments_admin_read on payments;
create policy payments_admin_read on payments for select using (is_admin());

-- Il token iCal non deve essere leggibile dalla vetrina
revoke select on rooms from anon;
grant select (id, slug, name, short_description, description, capacity, price_from, price_weekend,
              min_nights, amenities, sort_order, published, created_at) on rooms to anon;

-- ---------------------------------------------------------------------
-- Storage: bucket pubblico "photos" per le immagini
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists photos_bucket_admin_insert on storage.objects;
create policy photos_bucket_admin_insert on storage.objects for insert
  with check (bucket_id = 'photos' and public.is_admin());
drop policy if exists photos_bucket_admin_update on storage.objects;
create policy photos_bucket_admin_update on storage.objects for update
  using (bucket_id = 'photos' and public.is_admin());
drop policy if exists photos_bucket_admin_delete on storage.objects;
create policy photos_bucket_admin_delete on storage.objects for delete
  using (bucket_id = 'photos' and public.is_admin());
