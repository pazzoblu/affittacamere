-- =====================================================================
-- AffittaCamere - schema database Supabase
-- Da eseguire in Supabase > SQL Editor. È rieseguibile: dopo un aggiornamento
-- del progetto basta rieseguirlo per aggiungere tabelle e colonne nuove.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Utenti dell'area riservata e ruoli. Un utente può avere più ruoli:
--   admin         fa tutto e gestisce gli utenti
--   camere        anagrafica della struttura: camere, foto, testi del sito
--   prenotazioni  calendario, prenotazioni, link di pagamento, calendari Booking/Airbnb
--   prezzi        prezzi delle camere, stagioni, impostazioni dei pagamenti online
-- ---------------------------------------------------------------------
create table if not exists staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  name       text not null default '',
  roles      text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint staff_roles_chk check (roles <@ array['admin','camere','prenotazioni','prezzi']::text[])
);

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid());
$$;

-- l'admin ha implicitamente tutti i ruoli
create or replace function has_role(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid()
                 and ('admin' = any(roles) or p_role = any(roles)));
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid() and 'admin' = any(roles));
$$;

-- deve sempre restare almeno un amministratore
create or replace function staff_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from staff where 'admin' = any(roles)) then
    raise exception 'Deve restare almeno un amministratore';
  end if;
  return null;
end;
$$;
drop trigger if exists staff_keep_admin on staff;
create constraint trigger staff_keep_admin after update or delete on staff
  deferrable initially deferred for each row execute function staff_keep_admin();

-- aggiornamento dalla versione con la tabella "admins": i vecchi admin diventano amministratori
do $$
begin
  if to_regclass('public.admins') is not null then
    insert into staff(user_id, email, roles)
      select a.user_id, coalesce(u.email, ''), array['admin']
      from admins a join auth.users u on u.id = a.user_id
    on conflict (user_id) do nothing;
    drop table admins;
  end if;
end;
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
-- Codice Identificativo Nazionale (obbligatorio negli annunci) ed eventuale codice regionale
alter table rooms add column if not exists cin text not null default '';
alter table rooms add column if not exists cir text not null default '';

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
  ('titolo',      'La mia casa vacanze'),
  ('sottotitolo', 'Una casa accogliente per le tue vacanze'),
  ('chi_siamo',   'Scrivi qui una presentazione della tua struttura.'),
  ('indirizzo',   ''),
  ('telefono',    ''),
  ('email',       ''),
  ('whatsapp',    ''),
  ('hero_image',  ''),
  ('pagamenti_attivi',         '0'),
  ('acconto_percentuale',      '30'),
  ('condizioni_cancellazione', 'Cancellazione gratuita fino a 7 giorni prima dell''arrivo. In seguito l''acconto non è rimborsabile.'),
  ('titolare',  ''),
  ('cf_piva',   ''),
  -- data dell'ultima modifica di termini, regolamento o cancellazione: si registra in ogni prenotazione
  ('termini_versione', '2026-10-24'),
  -- testi modello: le parti tra [quadre] vanno completate dall'area riservata
  ('termini', $txt$1. Oggetto
La prenotazione riguarda la locazione turistica dell'alloggio scelto, per le date indicate, a uso esclusivamente abitativo e turistico. I dati del gestore sono indicati in fondo a ogni pagina del sito.

2. Prezzo
Il prezzo mostrato al momento della prenotazione è il totale del soggiorno e comprende [biancheria, pulizia finale, consumi di luce, acqua e gas]. Non comprende l'imposta di soggiorno, se prevista dal Comune, da pagare all'arrivo: [importo per persona a notte ed esenzioni].

3. Prenotazione e pagamento
La richiesta inviata dal sito diventa una prenotazione solo quando la confermiamo via email. Se paghi online, la prenotazione è confermata al momento del pagamento. L'eventuale saldo si paga [all'arrivo, in contanti o con carta].

4. Arrivo e partenza
Check-in dalle [15:00] alle [20:00], check-out entro le [10:00]. Gli arrivi fuori orario vanno concordati.

5. Documenti
All'arrivo ogni ospite deve presentare un documento d'identità valido: per legge comunichiamo le generalità degli ospiti alla Questura (Alloggiati Web) entro 24 ore. Senza documenti non possiamo consegnare l'alloggio.

6. Numero di ospiti
L'alloggio può essere occupato solo dalle persone indicate nella prenotazione, entro la capienza massima.

7. Deposito cauzionale e danni
[Eventuale deposito cauzionale di € ..., restituito alla partenza dopo la verifica dell'alloggio.] L'ospite risponde dei danni causati all'alloggio e agli arredi durante il soggiorno.

8. Regolamento della casa
Durante il soggiorno vale il Regolamento della casa, che fa parte di queste condizioni.

9. Legge applicabile
Si applica la legge italiana. Per le controversie con i consumatori è competente il foro del luogo di residenza del consumatore.$txt$),
  ('regolamento', $txt$Nell'alloggio è vietato fumare [anche su balconi e terrazzi].

Animali: [non ammessi / ammessi su richiesta].

Non sono ammessi ospiti non indicati nella prenotazione, né feste o eventi.

Rispetta il riposo dei vicini, in particolare dalle [22:00] alle [8:00].

Fai la raccolta differenziata seguendo le indicazioni lasciate nell'alloggio.

Alla partenza lascia le chiavi [nel punto concordato], chiudi porte, finestre e rubinetti e spegni luci e climatizzatore.

Segnala subito eventuali guasti o danni.

Il gestore entra nell'alloggio durante il soggiorno solo per urgenze, avvisando prima quando possibile.$txt$)
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
-- check_out è il giorno di partenza (escluso dal soggiorno).
-- Del cliente si conservano solo l'email e il codice prenotazione.
-- ---------------------------------------------------------------------

-- Codice prenotazione leggibile, senza caratteri ambigui (0/O, 1/I/L)
create or replace function gen_booking_code() returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 8);
$$;

create table if not exists bookings (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references rooms(id) on delete cascade,
  check_in       date not null,
  check_out      date not null,
  status         text not null default 'confermata'
                 check (status in ('richiesta','confermata','annullata')),
  source         text not null default 'diretta'
                 check (source in ('diretta','sito','booking','airbnb','altro')),
  guest_email    text not null default '',
  guests         int,
  price          numeric(10,2),  -- prezzo totale del soggiorno
  notes          text not null default '',  -- note interne dello staff
  ical_source_id uuid references ical_sources(id) on delete cascade,
  external_uid   text,
  created_at     timestamptz not null default now(),
  constraint bookings_dates_chk check (check_out > check_in),
  constraint bookings_external_uq unique (ical_source_id, external_uid)
);
create index if not exists bookings_room_dates_idx on bookings(room_id, check_in, check_out);

alter table bookings add column if not exists code text not null default gen_booking_code();
create unique index if not exists bookings_code_uq on bookings(code);
alter table bookings add column if not exists cancel_requested_at timestamptz;
-- messaggio del cliente durante un pagamento online: passa nelle notifiche a pagamento concluso
alter table bookings add column if not exists pending_message text;
-- accettazione di termini e regolamento al momento della prenotazione dal sito (quando e quale versione)
alter table bookings add column if not exists terms_accepted_at timestamptz;
alter table bookings add column if not exists terms_version text;
-- dalla versione precedente: nome e telefono del cliente non si conservano più
alter table bookings drop column if exists guest_name;
alter table bookings drop column if exists guest_phone;

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

-- Notifiche per lo staff: richieste, pagamenti, cancellazioni e messaggi dei clienti.
-- Le scrivono solo le funzioni del database; le leggono admin e ruolo "prenotazioni".
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade,
  kind       text not null check (kind in ('richiesta','pagamento','cancellazione','messaggio')),
  message    text not null default '',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_created_idx on notifications(created_at desc);

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
    raise exception 'Alloggio non trovato';
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
drop function if exists validate_site_booking(uuid, date, date, text, text, text, int);
create or replace function validate_site_booking(
  p_room uuid, p_check_in date, p_check_out date, p_email text, p_guests int
) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_room rooms%rowtype;
begin
  select * into v_room from rooms where id = p_room and published;
  if not found then
    raise exception 'Alloggio non trovato';
  end if;
  if p_check_in < current_date or p_check_out <= p_check_in then
    raise exception 'Date non valide';
  end if;
  if p_check_out - p_check_in > 60 then
    raise exception 'Soggiorno troppo lungo: contattaci direttamente';
  end if;
  if p_check_out - p_check_in < v_room.min_nights then
    raise exception 'Il soggiorno minimo è di % notti', v_room.min_nights;
  end if;
  if coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Inserisci un indirizzo email valido';
  end if;
  if p_guests is not null and (p_guests < 1 or p_guests > v_room.capacity) then
    raise exception 'Numero ospiti non valido per questo alloggio (max %)', v_room.capacity;
  end if;
  if not room_is_free(p_room, p_check_in, p_check_out) then
    raise exception 'L''alloggio non è disponibile in queste date';
  end if;
  -- limite anti-spam: max 20 richieste aperte dal sito
  if (select count(*) from bookings where source = 'sito' and status = 'richiesta') >= 20 then
    raise exception 'Troppe richieste in attesa, riprova più tardi o contattaci';
  end if;
end;
$$;

create or replace function notify_staff(p_booking uuid, p_kind text, p_message text)
returns void
language sql security definer set search_path = public as $$
  insert into notifications(booking_id, kind, message) values (p_booking, p_kind, left(coalesce(trim(p_message), ''), 2000));
$$;

-- Richiesta di prenotazione dal sito: entra come "richiesta", la confermi tu.
-- Restituisce il codice prenotazione da comunicare al cliente.
-- Senza accettazione esplicita di termini e regolamento non si prenota; restituisce la versione accettata
create or replace function accepted_terms_version(p_accepted boolean) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(p_accepted, false) then
    raise exception 'Per prenotare devi accettare i Termini e condizioni e il Regolamento della casa';
  end if;
  return coalesce((select value from site_content where key = 'termini_versione'), '');
end;
$$;

drop function if exists request_booking(uuid, date, date, text, text, text, int, text);
drop function if exists request_booking(uuid, date, date, text, int, text);
create or replace function request_booking(
  p_room uuid, p_check_in date, p_check_out date, p_email text, p_guests int, p_message text, p_terms_accepted boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_code text;
  v_terms text := accepted_terms_version(p_terms_accepted);
begin
  perform validate_site_booking(p_room, p_check_in, p_check_out, p_email, p_guests);
  insert into bookings(room_id, check_in, check_out, status, source, price, guest_email, guests,
                       terms_accepted_at, terms_version)
  values (p_room, p_check_in, p_check_out, 'richiesta', 'sito', quote_price(p_room, p_check_in, p_check_out),
          lower(left(trim(p_email), 200)), p_guests, now(), v_terms)
  returning id, code into v_id, v_code;
  perform notify_staff(v_id, 'richiesta', p_message);
  return v_code;
end;
$$;

-- Stato di una prenotazione per la pagina di esito del pagamento (l'id è un uuid non indovinabile)
drop function if exists booking_public_status(uuid);
create or replace function booking_public_status(p_id uuid)
returns table(code text, status text, payment_status text, amount_paid numeric, price numeric,
              check_in date, check_out date, room_name text, room_slug text)
language sql stable security definer set search_path = public as $$
  select b.code, b.status, b.payment_status, b.amount_paid, b.price, b.check_in, b.check_out, r.name, r.slug
  from bookings b join rooms r on r.id = b.room_id
  where b.id = p_id and b.source = 'sito';
$$;

-- "La mia prenotazione": il cliente la ritrova con codice + email
create or replace function booking_lookup(p_code text, p_email text)
returns table(code text, status text, payment_status text, amount_paid numeric, price numeric,
              check_in date, check_out date, guests int, room_name text, room_slug text,
              cancel_requested_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.code, b.status, b.payment_status, b.amount_paid, b.price, b.check_in, b.check_out, b.guests,
         r.name, r.slug, b.cancel_requested_at
  from bookings b join rooms r on r.id = b.room_id
  where b.code = upper(trim(p_code)) and b.guest_email <> '' and b.guest_email = lower(trim(p_email))
    -- le prenotazioni online mai pagate non esistono per il cliente
    and not (b.payment_status = 'in_attesa' and b.status = 'annullata');
$$;

-- Trova la prenotazione del cliente o dà errore; limita i messaggi a 10 al giorno
create or replace function guest_booking_id(p_code text, p_email text)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from bookings
  where code = upper(trim(p_code)) and guest_email <> '' and guest_email = lower(trim(p_email));
  if v_id is null then
    raise exception 'Prenotazione non trovata: controlla codice ed email';
  end if;
  if (select count(*) from notifications where booking_id = v_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Hai inviato troppi messaggi oggi: riprova domani o contattaci direttamente';
  end if;
  return v_id;
end;
$$;

create or replace function request_cancellation(p_code text, p_email text, p_message text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := guest_booking_id(p_code, p_email);
  v_b bookings%rowtype;
begin
  select * into v_b from bookings where id = v_id;
  if v_b.status = 'annullata' then
    raise exception 'La prenotazione è già annullata';
  end if;
  if v_b.check_in < current_date then
    raise exception 'Il soggiorno è già iniziato: contattaci direttamente';
  end if;
  if v_b.cancel_requested_at is not null then
    raise exception 'Hai già richiesto la cancellazione: ti risponderemo al più presto';
  end if;
  update bookings set cancel_requested_at = now() where id = v_id;
  perform notify_staff(v_id, 'cancellazione', p_message);
end;
$$;

create or replace function send_guest_message(p_code text, p_email text, p_message text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_message), '') = '' then
    raise exception 'Scrivi il messaggio';
  end if;
  perform notify_staff(guest_booking_id(p_code, p_email), 'messaggio', p_message);
end;
$$;

-- ---------------------------------------------------------------------
-- Funzioni di pagamento: le chiamano solo le Edge Functions (service role)
-- ---------------------------------------------------------------------

-- Prenotazione online: blocca le date per 35 minuti in attesa del pagamento
drop function if exists create_online_booking(uuid, date, date, text, text, text, int, text, text);
drop function if exists create_online_booking(uuid, date, date, text, int, text, text);
create or replace function create_online_booking(
  p_room uuid, p_check_in date, p_check_out date, p_email text, p_guests int, p_message text, p_mode text,
  p_terms_accepted boolean
) returns table(booking_id uuid, code text, room_name text, total numeric, amount numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_quote record;
  v_id uuid;
  v_code text;
  v_amount numeric;
  v_terms text := accepted_terms_version(p_terms_accepted);
begin
  if p_mode not in ('acconto', 'totale') then
    raise exception 'Modalità di pagamento non valida';
  end if;
  perform validate_site_booking(p_room, p_check_in, p_check_out, p_email, p_guests);
  select * into v_quote from quote_booking(p_room, p_check_in, p_check_out);
  if not v_quote.online_payment then
    raise exception 'Pagamento online non disponibile per queste date: invia una richiesta';
  end if;
  v_amount := case when p_mode = 'totale' then v_quote.total else v_quote.deposit end;

  insert into bookings(room_id, check_in, check_out, status, source, price, payment_status, expires_at,
                       guest_email, guests, pending_message, terms_accepted_at, terms_version)
  values (p_room, p_check_in, p_check_out, 'richiesta', 'sito', v_quote.total, 'in_attesa', now() + interval '35 minutes',
          lower(left(trim(p_email), 200)), p_guests, nullif(left(coalesce(trim(p_message), ''), 2000), ''),
          now(), v_terms)
  returning id, bookings.code into v_id, v_code;

  return query select v_id, v_code, (select name from rooms where id = p_room), v_quote.total, v_amount;
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
    amount_paid     = v_paid,
    payment_status  = case when v_paid >= coalesce(price, 0) then 'pagato' else 'acconto' end,
    expires_at      = null,
    pending_message = null,
    status = case
      when status = 'richiesta' then 'confermata'
      -- caso raro: annullata mentre l'ospite pagava; si riattiva solo se la camera è ancora libera
      when status = 'annullata' and room_is_free(room_id, check_in, check_out, id) then 'confermata'
      else status end,
    notes = case
      when status = 'annullata' and not room_is_free(room_id, check_in, check_out, id)
      then trim(notes || E'\nATTENZIONE: pagamento ricevuto su prenotazione annullata, alloggio non più libero: verificare o rimborsare.')
      else notes end
  where id = v_b.id;

  perform notify_staff(v_b.id, 'pagamento',
    format('Pagamento online di %s € ricevuto.', replace(to_char(v_pay.amount, 'FM9999990.00'), '.', ','))
    || coalesce(E'\n\nMessaggio del cliente: ' || v_b.pending_message, ''));
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
    update bookings set status = 'annullata', payment_status = 'nessuno', expires_at = null, pending_message = null
    where id = v_pay.booking_id and status = 'richiesta' and amount_paid = 0;
  end if;
end;
$$;

revoke execute on function quote_price(uuid, date, date) from public, anon;
grant execute on function quote_price(uuid, date, date) to authenticated;  -- "calcola dai listini" nell admin
revoke execute on function room_is_free(uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function validate_site_booking(uuid, date, date, text, int) from public, anon, authenticated;
revoke execute on function notify_staff(uuid, text, text) from public, anon, authenticated;
revoke execute on function guest_booking_id(text, text) from public, anon, authenticated;
revoke execute on function create_online_booking(uuid, date, date, text, int, text, text, boolean) from public, anon, authenticated;
revoke execute on function accepted_terms_version(boolean) from public, anon, authenticated;
revoke execute on function register_payment(text, text) from public, anon, authenticated;
revoke execute on function expire_payment(text) from public, anon, authenticated;
grant execute on function room_busy_ranges(uuid, date, date) to anon, authenticated;
grant execute on function quote_booking(uuid, date, date) to anon, authenticated;
grant execute on function request_booking(uuid, date, date, text, int, text, boolean) to anon, authenticated;
grant execute on function booking_public_status(uuid) to anon, authenticated;
grant execute on function booking_lookup(text, text) to anon, authenticated;
grant execute on function request_cancellation(text, text, text) to anon, authenticated;
grant execute on function send_guest_message(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Permessi per colonna sulle camere: i prezzi li cambia solo chi ha il
-- ruolo "prezzi", il resto dell'anagrafica solo chi ha il ruolo "camere".
-- Dal SQL Editor (nessun utente collegato) non ci sono limiti.
-- ---------------------------------------------------------------------
create or replace function rooms_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not has_role('camere') then
      raise exception 'Non hai i permessi per aggiungere alloggi';
    end if;
    if not has_role('prezzi') and (new.price_from is not null or new.price_weekend is not null or new.min_nights <> 1) then
      raise exception 'Non hai i permessi per impostare i prezzi';
    end if;
  else
    if (new.price_from, new.price_weekend, new.min_nights) is distinct from (old.price_from, old.price_weekend, old.min_nights)
       and not has_role('prezzi') then
      raise exception 'Non hai i permessi per modificare i prezzi';
    end if;
    if (new.slug, new.name, new.short_description, new.description, new.capacity, new.amenities, new.sort_order, new.published, new.cin, new.cir)
       is distinct from (old.slug, old.name, old.short_description, old.description, old.capacity, old.amenities, old.sort_order, old.published, old.cin, old.cir)
       and not has_role('camere') then
      raise exception 'Non hai i permessi per modificare i dati dell''alloggio';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists rooms_guard on rooms;
create trigger rooms_guard before insert or update on rooms
  for each row execute function rooms_guard();

-- Impostazioni dei pagamenti (ruolo "prezzi"); le altre chiavi sono testi del sito (ruolo "camere")
create or replace function is_payment_setting(p_key text) returns boolean
language sql immutable as $$
  select p_key in ('pagamenti_attivi', 'acconto_percentuale', 'condizioni_cancellazione');
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table staff         enable row level security;
alter table rooms         enable row level security;
alter table room_photos   enable row level security;
alter table season_prices enable row level security;
alter table site_content  enable row level security;
alter table ical_sources  enable row level security;
alter table bookings      enable row level security;
alter table payments      enable row level security;

-- ognuno vede il proprio profilo; l'admin vede e modifica tutti (creazione ed
-- eliminazione degli utenti passano dalla funzione "users")
drop policy if exists staff_read on staff;
create policy staff_read on staff for select using (user_id = auth.uid() or is_admin());
drop policy if exists staff_admin_update on staff;
create policy staff_admin_update on staff for update using (is_admin()) with check (is_admin());

-- policy della versione precedente (solo admin)
drop policy if exists rooms_admin_write on rooms;
drop policy if exists photos_admin_write on room_photos;
drop policy if exists seasons_admin_all on season_prices;
drop policy if exists content_admin_write on site_content;
drop policy if exists ical_admin_all on ical_sources;
drop policy if exists bookings_admin_all on bookings;
drop policy if exists payments_admin_read on payments;

drop policy if exists rooms_public_read on rooms;
create policy rooms_public_read on rooms for select using (published or is_staff());
drop policy if exists rooms_insert on rooms;
create policy rooms_insert on rooms for insert with check (has_role('camere'));
drop policy if exists rooms_update on rooms;
create policy rooms_update on rooms for update
  using (has_role('camere') or has_role('prezzi')) with check (has_role('camere') or has_role('prezzi'));
drop policy if exists rooms_delete on rooms;
create policy rooms_delete on rooms for delete using (has_role('camere'));

drop policy if exists photos_public_read on room_photos;
create policy photos_public_read on room_photos for select
  using (is_staff() or exists (select 1 from rooms r where r.id = room_id and r.published));
drop policy if exists photos_write on room_photos;
create policy photos_write on room_photos for all using (has_role('camere')) with check (has_role('camere'));

drop policy if exists seasons_read on season_prices;
create policy seasons_read on season_prices for select using (is_staff());
drop policy if exists seasons_write on season_prices;
create policy seasons_write on season_prices for all using (has_role('prezzi')) with check (has_role('prezzi'));

drop policy if exists content_public_read on site_content;
create policy content_public_read on site_content for select using (true);
drop policy if exists content_write on site_content;
-- la versione dei termini cambia sia con i testi (Alloggi) sia con la cancellazione (Prezzi)
create policy content_write on site_content for all
  using (case when key = 'termini_versione' then has_role('camere') or has_role('prezzi')
              when is_payment_setting(key) then has_role('prezzi') else has_role('camere') end)
  with check (case when key = 'termini_versione' then has_role('camere') or has_role('prezzi')
                   when is_payment_setting(key) then has_role('prezzi') else has_role('camere') end);

drop policy if exists ical_all on ical_sources;
create policy ical_all on ical_sources for all using (has_role('prenotazioni')) with check (has_role('prenotazioni'));

drop policy if exists bookings_all on bookings;
create policy bookings_all on bookings for all using (has_role('prenotazioni')) with check (has_role('prenotazioni'));

-- i pagamenti li scrivono solo le Edge Functions; chi gestisce le prenotazioni li legge
drop policy if exists payments_read on payments;
create policy payments_read on payments for select using (has_role('prenotazioni'));

-- notifiche: lette, segnate come lette ed eliminate da admin e ruolo "prenotazioni"
alter table notifications enable row level security;
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select using (has_role('prenotazioni'));
drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update using (has_role('prenotazioni')) with check (has_role('prenotazioni'));
drop policy if exists notifications_delete on notifications;
create policy notifications_delete on notifications for delete using (has_role('prenotazioni'));

-- Il token iCal non deve essere leggibile dalla vetrina
revoke select on rooms from anon;
grant select (id, slug, name, short_description, description, capacity, price_from, price_weekend, cin, cir,
              min_nights, amenities, sort_order, published, created_at) on rooms to anon;

-- ---------------------------------------------------------------------
-- Storage: bucket pubblico "photos" per le immagini (camere e copertina)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists photos_bucket_admin_insert on storage.objects;
create policy photos_bucket_admin_insert on storage.objects for insert
  with check (bucket_id = 'photos' and public.has_role('camere'));
drop policy if exists photos_bucket_admin_update on storage.objects;
create policy photos_bucket_admin_update on storage.objects for update
  using (bucket_id = 'photos' and public.has_role('camere'));
drop policy if exists photos_bucket_admin_delete on storage.objects;
create policy photos_bucket_admin_delete on storage.objects for delete
  using (bucket_id = 'photos' and public.has_role('camere'));
