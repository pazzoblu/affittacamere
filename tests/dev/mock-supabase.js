// Finto client Supabase in memoria (localStorage) per provare il sito senza un progetto reale.
// Lo usa solo tests/dev/server.mjs: non viene mai pubblicato.
// Login demo: qualsiasi password; l'email sceglie l'utente (admin@, camere@, prenotazioni@, prezzi@demo.test).

const KEY = 'affittacamere-demo-db-v7';

// Testi di prova della casa di Pacentro (gli stessi di contenuti/testi-pacentro.md)
const PACENTRO = {
  titolo: 'Dimora San Francesco',
  sottotitolo: 'Tranquillità, ambienti curati e la bellezza di uno dei borghi più belli d’Italia',
  chiSiamo: `Ti accogliamo alla Dimora San Francesco, la nostra casa nel centro storico di Pacentro, borgo medievale nel Parco Nazionale della Majella, tra i Borghi più belli d’Italia.

Ci teniamo che tu ti senta a casa: ogni ambiente viene pulito con cura prima di ogni arrivo e la biancheria è sempre fresca e in ordine.

Qui il tempo scorre lento: niente traffico, solo il silenzio delle montagne, il profumo dei camini e le passeggiate tra i vicoli in pietra.`,
  breve: 'Appartamento accogliente con camino e vista sulle montagne, nel cuore silenzioso di Pacentro',
  descrizione: `Un appartamento luminoso e curato nei dettagli, nel centro storico di Pacentro: il posto ideale per chi cerca tranquillità, aria pulita e panorami sulle montagne d’Abruzzo.

Il soggiorno con camino e la cucina attrezzata, con forno e piano cottura, sono perfetti per le serate in casa dopo una giornata all’aperto. La camera matrimoniale, con il suo letto in ferro battuto, è un angolo di quiete per riposare davvero. Il bagno, completo e luminoso, è sempre pulito e in ordine.

Dal balcone lo sguardo spazia dalla montagna che sovrasta il paese fino alle valli e ai monti all’orizzonte: la mattina, con il caffè in mano, è difficile non restare incantati.

Pacentro è uno dei Borghi più belli d’Italia: vicoli in pietra, scorci sulla Valle Peligna e le torri del Castello Caldora che dominano il paese. Siamo nel Parco Nazionale della Majella, con sentieri per escursioni a pochi passi, e a breve distanza da Sulmona. A settembre il borgo si anima con la storica Corsa degli Zingari.

Ogni ambiente viene pulito con cura prima di ogni arrivo e la biancheria è sempre fresca: troverai la casa esattamente come la vedi nelle foto.`,
  servizi: ['Camino', 'Cucina attrezzata con forno', 'Camera matrimoniale', 'Bagno completo', 'Riscaldamento',
    'Balcone con vista sulle montagne', 'Centro storico'],
  foto: [
    ['soggiorno', 'Il soggiorno con camino e la cucina attrezzata: pulito, ordinato e accogliente'],
    ['camera', 'La camera matrimoniale: tranquilla e silenziosa, per un riposo vero'],
    ['bagno', 'Il bagno, curato e sempre pulito, con biancheria fresca a ogni arrivo'],
    ['vista-valle', 'I tetti di Pacentro e le montagne d’Abruzzo all’orizzonte'],
    ['vista-monte', 'Dal balcone: il borgo ai piedi della montagna, a due passi dai sentieri della Majella'],
  ],
};
const iso = d => d.toISOString().slice(0, 10);
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const uuid = () => crypto.randomUUID();
const code = () => Array.from({ length: 8 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
const now = () => new Date().toISOString();

function seed() {
  const r1 = uuid(), r2 = uuid(), r3 = uuid(), s1 = uuid();
  const bookings = [
    { room_id: r1, check_in: day(2), check_out: day(5), status: 'confermata', source: 'diretta', guest_email: 'mario@example.com' },
    { room_id: r1, check_in: day(8), check_out: day(11), status: 'confermata', source: 'booking',
      ical_source_id: s1, external_uid: 'x1@booking.com' },
    { room_id: r1, check_in: day(10), check_out: day(12), status: 'confermata', source: 'airbnb' },
    { room_id: r2, check_in: day(-2), check_out: day(3), status: 'confermata', source: 'airbnb' },
    { room_id: r2, check_in: day(6), check_out: day(9), status: 'richiesta', source: 'sito',
      guest_email: 'luca@example.com', guests: 2 },
    { room_id: r2, check_in: day(15), check_out: day(18), status: 'confermata', source: 'sito', code: 'DEMO2345',
      guest_email: 'cliente@example.com', guests: 2, price: 255, amount_paid: 76.5, payment_status: 'acconto',
      cancel_requested_at: now() },
  ].map(b => ({ id: uuid(), code: code(), guest_email: '', guests: null, price: null, notes: '',
    ical_source_id: null, external_uid: null, amount_paid: 0, payment_status: 'nessuno', expires_at: null,
    cancel_requested_at: null, created_at: now(), ...b }));
  return {
    staff: [
      { user_id: 'demo-admin', email: 'admin@demo.test', name: 'Amministratore Demo', roles: ['admin'], last_sign_in_at: now() },
      { user_id: 'demo-camere', email: 'camere@demo.test', name: 'Anagrafica', roles: ['camere'] },
      { user_id: 'demo-prenotazioni', email: 'prenotazioni@demo.test', name: 'Reception', roles: ['prenotazioni'] },
      { user_id: 'demo-prezzi', email: 'prezzi@demo.test', name: '', roles: ['prezzi'] },
    ],
    site_content: [
      ['titolo', PACENTRO.titolo], ['sottotitolo', PACENTRO.sottotitolo],
      ['chi_siamo', PACENTRO.chiSiamo],
      ['indirizzo', 'Pacentro (AQ), Abruzzo'], ['telefono', '+39 091 000000'], ['email', 'info@example.com'],
      ['whatsapp', '+39 333 0000000'], ['hero_image', 'demo/vista-valle.jpg'], ['titolare', 'Mario Demo'], ['cf_piva', 'DMEMRA80A01G273X'],
      ['pagamenti_attivi', '1'], ['acconto_percentuale', '30'],
      ['condizioni_cancellazione', "Cancellazione gratuita fino a 7 giorni prima dell'arrivo."],
      ['termini_versione', '2026-10-24'],
      ['termini', "1. Oggetto\nLa prenotazione riguarda la locazione turistica dell'alloggio.\n\n2. Prezzo\nIl prezzo comprende [biancheria e pulizia finale]."],
      ['regolamento', 'Vietato fumare.\n\nNiente feste o eventi.'],
    ].map(([key, value]) => ({ key, value })),
    rooms: [
      { id: r1, slug: 'casa-nel-borgo', name: 'Casa nel borgo', short_description: PACENTRO.breve,
        description: PACENTRO.descrizione, capacity: 2, price_from: 135,
        price_weekend: null, min_nights: 1, discount_week: 15, discount_month: 30, cin: 'IT066066C2DEMO0001', cir: '', amenities: PACENTRO.servizi, sort_order: 0, published: true, ical_token: uuid() },
      // altri alloggi di esempio, non pubblicati (per provare la home con più case basta pubblicarli)
      { id: r2, slug: 'camera-verde', name: 'Camera Verde', short_description: 'Tripla luminosa',
        description: 'Camera tripla.', capacity: 3, price_from: 85, price_weekend: null, min_nights: 2, amenities: ['Wi-Fi', 'TV'],
        sort_order: 1, published: false, ical_token: uuid() },
      { id: r3, slug: 'suite', name: 'Suite', short_description: 'In allestimento', description: '', capacity: 4,
        price_from: null, price_weekend: null, min_nights: 1, amenities: [], sort_order: 2, published: false, ical_token: uuid() },
    ],
    room_photos: PACENTRO.foto.map(([file, caption], i) =>
      ({ id: uuid(), room_id: r1, path: `demo/${file}.jpg`, caption, sort_order: i })),
    season_prices: [],
    payments: [],
    ical_sources: [{ id: s1, room_id: r1, channel: 'booking', name: 'Booking.com',
      url: 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=demo', last_sync_at: null, last_error: null }],
    bookings,
    notifications: [
      { id: uuid(), booking_id: bookings[4].id, kind: 'richiesta', message: 'Arriviamo in serata, verso le 21.', read_at: null, created_at: now() },
      { id: uuid(), booking_id: bookings[5].id, kind: 'cancellazione', message: 'Purtroppo dobbiamo rinviare il viaggio.', read_at: null, created_at: now() },
    ],
  };
}

let db;
try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignora */ } };
save();

const notify = (booking_id, kind, message) =>
  db.notifications.push({ id: uuid(), booking_id, kind, message: message ?? '', read_at: null, created_at: now() });

class Query {
  constructor(table) { this.table = table; this.filters = []; this.orders = []; this.op = 'select'; }
  select(cols = '*', opts = {}) { if (this.op === 'select') this.cols = cols; this.returning = true; this.opts = opts; return this; }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  update(v) { this.op = 'update'; this.payload = v; return this; }
  upsert(rows) { this.op = 'upsert'; this.payload = rows; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
  lt(c, v) { this.filters.push(r => r[c] < v); return this; }
  gt(c, v) { this.filters.push(r => r[c] > v); return this; }
  gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
  in(c, v) { this.filters.push(r => v.includes(r[c])); return this; }
  is(c, v) { this.filters.push(r => (r[c] ?? null) === v); return this; }
  // solo il filtro usato dall'elenco "Da gestire"
  or() { this.filters.push(r => r.status === 'richiesta' || (r.status === 'confermata' && r.cancel_requested_at)); return this; }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false]); return this; }
  limit() { return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }

  run() {
    const rows = db[this.table];
    const match = r => this.filters.every(f => f(r));
    let out;
    if (this.op === 'insert') {
      out = [].concat(this.payload).map(p => ({ id: uuid(), ical_token: uuid(), code: code(), created_at: now(), ...p }));
      if (this.table === 'rooms' && out.some(n => rows.some(r => r.slug === n.slug)))
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      rows.push(...out);
    } else if (this.op === 'update') {
      out = rows.filter(match);
      out.forEach(r => Object.assign(r, this.payload));
    } else if (this.op === 'upsert') {
      out = [].concat(this.payload).map(p => {
        const ex = rows.find(r => r.key === p.key && p.key !== undefined);
        if (ex) return Object.assign(ex, p);
        const n = { id: uuid(), ...p }; rows.push(n); return n;
      });
    } else if (this.op === 'delete') {
      db[this.table] = rows.filter(r => !match(r));
      if (this.table === 'rooms') db.bookings = db.bookings.filter(b => db.rooms.some(r => r.id === b.room_id));
      if (this.table === 'ical_sources') db.bookings = db.bookings.filter(b => !b.ical_source_id || db.ical_sources.some(s => s.id === b.ical_source_id));
      out = [];
    } else {
      out = rows.filter(match).map(r => ({ ...r }));
      for (const [c, asc] of [...this.orders].reverse())
        out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      if (this.cols?.includes('room_photos('))
        out.forEach(r => { r.room_photos = db.room_photos.filter(p => p.room_id === r.id); });
      if (this.cols?.includes('bookings('))
        out.forEach(r => { r.bookings = db.bookings.find(b => b.id === r.booking_id) ?? null; });
      if (this.opts?.head) return { data: null, count: out.length, error: null };
    }
    save();
    if (this.one) {
      if (this.one === 'single' && out.length !== 1) return { data: null, error: { message: 'riga non trovata' } };
      return { data: out[0] ?? null, error: null };
    }
    return { data: out, error: null };
  }
}

// stessa logica di quote_price_base / stay_discount / quote_price nel database
function nextDay(d) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return iso(x); }
function stayDiscount(roomId, from, to) {
  const r = db.rooms.find(x => x.id === roomId);
  const n = Math.round((new Date(to) - new Date(from)) / 86400000);
  if (n >= 28 && Number(r.discount_month) > 0) return Number(r.discount_month);
  return n >= 7 ? Number(r.discount_week ?? 0) : 0;
}
function quotePrice(roomId, from, to) {
  const base = quotePriceBase(roomId, from, to);
  return base == null ? null : Math.round(base * (100 - stayDiscount(roomId, from, to))) / 100;
}
function quotePriceBase(roomId, from, to) {
  const room = db.rooms.find(r => r.id === roomId);
  let total = 0;
  for (let d = from; d < to; d = nextDay(d)) {
    const we = [5, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay());
    const s = db.season_prices.filter(x => x.room_id === roomId && x.date_from <= d && d <= x.date_to)
      .sort((a, b) => (a.date_from < b.date_from ? 1 : -1))[0];
    const p = s ? (we ? s.price_weekend ?? s.price_night : s.price_night)
      : (we ? room.price_weekend ?? room.price_from : room.price_from);
    if (p == null) return null;
    total += Number(p);
  }
  return total;
}
const content = k => db.site_content.find(c => c.key === k)?.value;
const isFree = (roomId, a, b) =>
  !db.bookings.some(x => x.room_id === roomId && x.status === 'confermata' && x.check_in < b && x.check_out > a);
const findGuest = (c, e) => db.bookings.find(b => b.code === String(c).trim().toUpperCase()
  && b.guest_email && b.guest_email === String(e).trim().toLowerCase());
const fail = message => ({ data: null, error: { message } });
const withRoom = b => { const r = db.rooms.find(x => x.id === b.room_id); return { ...b, room_name: r.name, room_slug: r.slug }; };

let session = null;
try { session = JSON.parse(sessionStorage.getItem('demo-session')); } catch { /* ignora */ }
const listeners = [];
const emit = (event = 'SIGNED_IN') => listeners.forEach(f => f(event, session));
const saveSession = () => sessionStorage.setItem('demo-session', JSON.stringify(session));
// verifica in due passaggi simulata: il codice giusto è sempre 123456
db.mfa ??= {};
const DEMO_QR = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7">'
  + '<path d="M0 0h3v3H0zM4 0h3v3H4zM0 4h3v3H0zM4 4h1v1H4zM6 6h1v1H6zM5 5h1v1H5z"/></svg>');

function usersFunction(body) {
  const ok = data => ({ data, error: null });
  const err = message => ({ data: null, error: { message, context: { json: async () => ({ error: message }) } } });
  const admins = () => db.staff.filter(s => s.roles.includes('admin')).length;
  if (body.action === 'list') return ok({ users: db.staff.map(s => ({ id: s.user_id, ...s, staff: true, mfa: !!db.mfa[s.user_id] })) });
  if (body.action === 'reset_mfa') {
    if (body.user_id === session?.user.id) return err('La tua verifica la può azzerare solo un altro amministratore');
    delete db.mfa[body.user_id];
    save();
    return ok({ ok: true });
  }
  if (body.action === 'create') {
    if (db.staff.some(s => s.email === body.email)) return err('Esiste già un utente con questa email');
    if (!body.roles.length) return err('Scegli almeno un ruolo');
    db.staff.push({ user_id: uuid(), email: body.email, name: body.name, roles: body.roles, pending: !body.password });
    save();
    return ok({ ok: true, link: body.password ? undefined
      : `https://demo.supabase.co/auth/v1/verify?token=finto&type=invite&redirect_to=${encodeURIComponent(body.redirect_to)}` });
  } else if (body.action === 'new_link') {
    return ok({ link: `https://demo.supabase.co/auth/v1/verify?token=finto&type=recovery&redirect_to=${encodeURIComponent(body.redirect_to)}` });
  } else if (body.action === 'update') {
    const s = db.staff.find(x => x.user_id === body.user_id);
    if (!body.roles.length) return err('Scegli almeno un ruolo');
    if (s.roles.includes('admin') && !body.roles.includes('admin') && admins() === 1) return err('Deve restare almeno un amministratore');
    Object.assign(s, { name: body.name, roles: body.roles });
  } else if (body.action === 'delete') {
    if (body.user_id === session?.user.id) return err('Non puoi eliminare il tuo utente');
    db.staff = db.staff.filter(x => x.user_id !== body.user_id);
  }
  save();
  return ok({ ok: true });
}

export function createClient() {
  return {
    from: t => new Query(t),
    rpc: async (fn, a) => {
      if (fn === 'room_busy_ranges')
        return { data: db.bookings.filter(b => b.room_id === a.p_room && b.status === 'confermata' && b.check_out > a.p_from)
          .map(b => ({ check_in: b.check_in, check_out: b.check_out })), error: null };
      if (fn === 'quote_price') return { data: quotePrice(a.p_room, a.p_check_in, a.p_check_out), error: null };
      if (fn === 'quote_booking') {
        const total = quotePrice(a.p_room, a.p_check_in, a.p_check_out);
        const pct = Number(content('acconto_percentuale')) || 30;
        return { data: [{ total, deposit: total == null ? null : Math.round(total * pct) / 100, deposit_percent: pct,
          available: isFree(a.p_room, a.p_check_in, a.p_check_out),
          online_payment: content('pagamenti_attivi') === '1' && total > 0,
          full_total: quotePriceBase(a.p_room, a.p_check_in, a.p_check_out),
          discount_percent: stayDiscount(a.p_room, a.p_check_in, a.p_check_out) }], error: null };
      }
      if (fn === 'booking_public_status') {
        const b = db.bookings.find(x => x.id === a.p_id);
        return { data: b ? [withRoom(b)] : [], error: null };
      }
      if (fn === 'request_booking') {
        if (!a.p_terms_accepted) return fail('Per prenotare devi accettare i Termini e condizioni e il Regolamento della casa');
        const b = { id: uuid(), code: code(), room_id: a.p_room, check_in: a.p_check_in, check_out: a.p_check_out,
          status: 'richiesta', source: 'sito', guest_email: a.p_email.trim().toLowerCase(), guests: a.p_guests,
          notes: '', price: quotePrice(a.p_room, a.p_check_in, a.p_check_out), amount_paid: 0, payment_status: 'nessuno',
          ical_source_id: null, external_uid: null, cancel_requested_at: null, created_at: now(),
          terms_accepted_at: now(), terms_version: content('termini_versione') };
        db.bookings.push(b);
        notify(b.id, 'richiesta', a.p_message);
        save();
        return { data: b.code, error: null };
      }
      if (fn === 'booking_lookup') {
        const b = findGuest(a.p_code, a.p_email);
        return { data: b ? [withRoom(b)] : [], error: null };
      }
      if (fn === 'request_cancellation' || fn === 'send_guest_message') {
        const b = findGuest(a.p_code, a.p_email);
        if (!b) return fail('Prenotazione non trovata: controlla codice ed email');
        if (fn === 'send_guest_message') {
          if (!a.p_message.trim()) return fail('Scrivi il messaggio');
          notify(b.id, 'messaggio', a.p_message);
        } else {
          if (b.cancel_requested_at) return fail('Hai già richiesto la cancellazione: ti risponderemo al più presto');
          b.cancel_requested_at = now();
          notify(b.id, 'cancellazione', a.p_message);
        }
        save();
        return { data: null, error: null };
      }
      return fail('rpc sconosciuta ' + fn);
    },
    auth: {
      onAuthStateChange: f => { listeners.push(f); setTimeout(() => f('INITIAL_SESSION', session)); },
      signInWithPassword: async ({ email }) => {
        const s = db.staff.find(x => x.email === email.trim().toLowerCase());
        session = { user: { id: s?.user_id ?? 'demo-sconosciuto', email }, aal: 'aal1' };
        saveSession();
        emit();
        return { error: null };
      },
      updateUser: async ({ password }) => (password === 'uguale123'
        ? { error: { code: 'same_password', message: 'same' } } : { data: {}, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      getSession: async () => ({ data: { session }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: {
          currentLevel: session?.aal === 'aal2' ? 'aal2' : 'aal1',
          nextLevel: db.mfa[session?.user.id] ? 'aal2' : 'aal1' }, error: null }),
        listFactors: async () => {
          const list = db.mfa[session?.user.id] ? [{ id: 'f-' + session.user.id, factor_type: 'totp', status: 'verified' }] : [];
          return { data: { totp: list, all: list }, error: null };
        },
        enroll: async () => ({ data: { id: 'f-' + session.user.id, type: 'totp',
          totp: { qr_code: DEMO_QR, secret: 'DEMO DEMO DEMO DEMO' } }, error: null }),
        unenroll: async () => ({ data: {}, error: null }),
        challengeAndVerify: async ({ code }) => {
          if (code !== '123456') return { data: null, error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } };
          db.mfa[session.user.id] = true;
          save();
          session = { ...session, aal: 'aal2' };
          saveSession();
          emit('MFA_CHALLENGE_VERIFIED');
          return { data: {}, error: null };
        },
      },
      signOut: async () => { session = null; sessionStorage.removeItem('demo-session'); emit(); },
    },
    storage: {
      from: () => ({
        // le foto "demo/..." sono quelle vere della casa, servite da tests/dev/demo-photos
        getPublicUrl: p => ({ data: { publicUrl: p.startsWith('demo/') ? `/demo-photos/${p.slice(5)}`
          : `https://picsum.photos/seed/${encodeURIComponent(p)}/1200/900` } }),
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    functions: {
      invoke: async (name, { body } = {}) => {
        if (name === 'users') return usersFunction(body);
        if (name === 'payments') {
          // simula Stripe: il pagamento riesce subito
          if (body.action === 'checkout') {
            const total = quotePrice(body.room_id, body.check_in, body.check_out);
            const amount = body.mode === 'totale' ? total
              : Math.round(total * (Number(content('acconto_percentuale')) || 30)) / 100;
            const id = uuid();
            db.bookings.push({ id, code: code(), room_id: body.room_id, check_in: body.check_in, check_out: body.check_out,
              status: 'confermata', source: 'sito', guest_email: body.email.trim().toLowerCase(), guests: body.guests,
              notes: '', price: total, amount_paid: amount, payment_status: amount >= total ? 'pagato' : 'acconto',
              expires_at: null, ical_source_id: null, external_uid: null, cancel_requested_at: null, created_at: now() });
            db.payments.push({ id: uuid(), booking_id: id, kind: body.mode, amount, status: 'pagato', created_at: now() });
            notify(id, 'pagamento', `Pagamento online di ${amount.toFixed(2).replace('.', ',')} € ricevuto.` +
              (body.message ? `\n\nMessaggio del cliente: ${body.message}` : ''));
            save();
            return { data: { url: `pagamento.html?b=${id}&esito=ok`, booking_id: id }, error: null };
          }
          if (body.action === 'link') {
            db.payments.push({ id: uuid(), booking_id: body.booking_id, kind: 'link', amount: body.amount,
              status: 'in_attesa', created_at: now() });
            save();
            return { data: { url: 'https://checkout.stripe.com/c/pay/cs_test_demo' }, error: null };
          }
          return { data: { ok: true }, error: null };
        }
        db.ical_sources.forEach(s => { s.last_sync_at = now(); });
        save();
        return { data: { results: db.ical_sources.map(s => ({ id: s.id, name: s.name, events: 1, removed: 0 })) }, error: null };
      },
    },
  };
}
