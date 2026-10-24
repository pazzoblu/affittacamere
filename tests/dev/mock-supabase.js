// Finto client Supabase in memoria (localStorage) per provare il sito senza un progetto reale.
// Lo usa solo tests/dev/server.mjs: non viene mai pubblicato.

const KEY = 'affittacamere-demo-db-v2';
const iso = d => d.toISOString().slice(0, 10);
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const uuid = () => crypto.randomUUID();

function seed() {
  const r1 = uuid(), r2 = uuid(), r3 = uuid(), s1 = uuid();
  return {
    admins: [{ user_id: 'demo-user' }],
    site_content: [
      ['titolo', 'Casa Demo'], ['sottotitolo', 'Camere accoglienti a due passi dal centro'],
      ['chi_siamo', 'Siamo una piccola struttura a conduzione familiare.\n\nTi aspettiamo per un soggiorno rilassante.'],
      ['indirizzo', 'Via Roma 1, Palermo'], ['telefono', '+39 091 000000'], ['email', 'info@example.com'],
      ['whatsapp', '+39 333 0000000'], ['hero_image', ''],
      ['pagamenti_attivi', '1'], ['acconto_percentuale', '30'],
      ['condizioni_cancellazione', "Cancellazione gratuita fino a 7 giorni prima dell'arrivo."],
    ].map(([key, value]) => ({ key, value })),
    rooms: [
      { id: r1, slug: 'camera-blu', name: 'Camera Blu', short_description: 'Matrimoniale con balcone vista mare',
        description: 'Ampia camera matrimoniale.\n\nBagno privato con doccia.', capacity: 2, price_from: 70,
        price_weekend: 90, min_nights: 1, amenities: ['Wi-Fi', 'Aria condizionata', 'Balcone'], sort_order: 0, published: true, ical_token: uuid() },
      { id: r2, slug: 'camera-verde', name: 'Camera Verde', short_description: 'Tripla luminosa',
        description: 'Camera tripla.', capacity: 3, price_from: 85, price_weekend: null, min_nights: 2, amenities: ['Wi-Fi', 'TV'],
        sort_order: 1, published: true, ical_token: uuid() },
      { id: r3, slug: 'suite', name: 'Suite', short_description: 'In allestimento', description: '', capacity: 4,
        price_from: null, price_weekend: null, min_nights: 1, amenities: [], sort_order: 2, published: false, ical_token: uuid() },
    ],
    room_photos: [],
    season_prices: [],
    payments: [],
    ical_sources: [{ id: s1, room_id: r1, channel: 'booking', name: 'Booking.com',
      url: 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=demo', last_sync_at: null, last_error: null }],
    bookings: [
      { room_id: r1, check_in: day(2), check_out: day(5), status: 'confermata', source: 'diretta', guest_name: 'Mario Rossi' },
      { room_id: r1, check_in: day(8), check_out: day(11), status: 'confermata', source: 'booking',
        ical_source_id: s1, external_uid: 'x1@booking.com' },
      { room_id: r1, check_in: day(10), check_out: day(12), status: 'confermata', source: 'airbnb' },
      { room_id: r2, check_in: day(-2), check_out: day(3), status: 'confermata', source: 'airbnb', guest_name: 'Anna B.' },
      { room_id: r2, check_in: day(6), check_out: day(9), status: 'richiesta', source: 'sito', guest_name: 'Luca Verdi',
        guest_email: 'luca@example.com', guests: 2, notes: 'Arriviamo in serata' },
    ].map(b => ({ id: uuid(), guest_name: '', guest_email: '', guest_phone: '', guests: null, price: null, notes: '',
      ical_source_id: null, external_uid: null, amount_paid: 0, payment_status: 'nessuno', expires_at: null,
      created_at: new Date().toISOString(), ...b })),
  };
}

let db;
try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignora */ } };
save();

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
      out = [].concat(this.payload).map(p => ({ id: uuid(), ical_token: uuid(), created_at: new Date().toISOString(), ...p }));
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

// stessa logica di quote_price nel database
function nextDay(d) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return iso(x); }
function quotePrice(roomId, from, to) {
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

let session = null;
try { session = JSON.parse(sessionStorage.getItem('demo-session')); } catch { /* ignora */ }
const listeners = [];
const emit = () => listeners.forEach(f => f('SIGNED_IN', session));

export function createClient() {
  return {
    from: t => new Query(t),
    rpc: async (fn, a) => {
      if (fn === 'is_admin') return { data: !!session, error: null };
      if (fn === 'room_busy_ranges')
        return { data: db.bookings.filter(b => b.room_id === a.p_room && b.status === 'confermata' && b.check_out > a.p_from)
          .map(b => ({ check_in: b.check_in, check_out: b.check_out })), error: null };
      if (fn === 'quote_price') return { data: quotePrice(a.p_room, a.p_check_in, a.p_check_out), error: null };
      if (fn === 'quote_booking') {
        const total = quotePrice(a.p_room, a.p_check_in, a.p_check_out);
        const pct = Number(content('acconto_percentuale')) || 30;
        return { data: [{ total, deposit: total == null ? null : Math.round(total * pct) / 100, deposit_percent: pct,
          available: isFree(a.p_room, a.p_check_in, a.p_check_out),
          online_payment: content('pagamenti_attivi') === '1' && total > 0 }], error: null };
      }
      if (fn === 'booking_public_status') {
        const b = db.bookings.find(x => x.id === a.p_id);
        const r = b && db.rooms.find(x => x.id === b.room_id);
        return { data: b ? [{ ...b, room_name: r.name, room_slug: r.slug }] : [], error: null };
      }
      if (fn === 'request_booking') {
        db.bookings.push({ id: uuid(), room_id: a.p_room, check_in: a.p_check_in, check_out: a.p_check_out,
          status: 'richiesta', source: 'sito', guest_name: a.p_name, guest_email: a.p_email, guest_phone: a.p_phone,
          guests: a.p_guests, notes: a.p_notes, price: null, ical_source_id: null, external_uid: null });
        save();
        return { data: uuid(), error: null };
      }
      return { data: null, error: { message: 'rpc sconosciuta ' + fn } };
    },
    auth: {
      onAuthStateChange: f => { listeners.push(f); setTimeout(() => f('INITIAL_SESSION', session)); },
      signInWithPassword: async () => {
        session = { user: { id: 'demo-user' } };
        sessionStorage.setItem('demo-session', JSON.stringify(session));
        emit();
        return { error: null };
      },
      updateUser: async ({ password }) => (password === 'uguale123'
        ? { error: { code: 'same_password', message: 'same' } } : { data: {}, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      signOut: async () => { session = null; sessionStorage.removeItem('demo-session'); emit(); },
    },
    storage: {
      from: () => ({
        getPublicUrl: p => ({ data: { publicUrl: p.startsWith('data:') ? p : `https://picsum.photos/seed/${encodeURIComponent(p)}/1200/900` } }),
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    functions: {
      invoke: async (name, { body } = {}) => {
        if (name === 'payments') {
          // simula Stripe: il pagamento riesce subito
          if (body.action === 'checkout') {
            const total = quotePrice(body.room_id, body.check_in, body.check_out);
            const amount = body.mode === 'totale' ? total
              : Math.round(total * (Number(content('acconto_percentuale')) || 30)) / 100;
            const id = uuid();
            db.bookings.push({ id, room_id: body.room_id, check_in: body.check_in, check_out: body.check_out,
              status: 'confermata', source: 'sito', guest_name: body.name, guest_email: body.email, guest_phone: body.phone,
              guests: body.guests, notes: body.notes, price: total, amount_paid: amount,
              payment_status: amount >= total ? 'pagato' : 'acconto', expires_at: null, ical_source_id: null, external_uid: null });
            db.payments.push({ id: uuid(), booking_id: id, kind: body.mode, amount, status: 'pagato',
              created_at: new Date().toISOString() });
            save();
            return { data: { url: `pagamento.html?b=${id}&esito=ok`, booking_id: id }, error: null };
          }
          if (body.action === 'link') {
            db.payments.push({ id: uuid(), booking_id: body.booking_id, kind: 'link', amount: body.amount,
              status: 'in_attesa', created_at: new Date().toISOString() });
            save();
            return { data: { url: 'https://checkout.stripe.com/c/pay/cs_test_demo' }, error: null };
          }
          return { data: { ok: true }, error: null };
        }
        db.ical_sources.forEach(s => { s.last_sync_at = new Date().toISOString(); });
        save();
        return { data: { results: db.ical_sources.map(s => ({ id: s.id, name: s.name, events: 1, removed: 0 })) }, error: null };
      },
    },
  };
}
