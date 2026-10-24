// Pagamenti con Stripe Checkout (carte, Apple Pay, Google Pay, PayPal, Klarna... secondo i metodi
// attivati nella Dashboard Stripe). Azioni:
//   checkout  (pubblica) prenotazione dal sito: blocca le date e restituisce la pagina di pagamento
//   cancel    (pubblica) l'ospite è tornato indietro senza pagare: libera subito le date
//   link      (staff prenotazioni) link di pagamento per una prenotazione esistente, valido 23 ore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { stripeRequest } from '../_shared/stripe.ts';
import { hasRole } from '../_shared/admin.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SITE_URL = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');

const fmt = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

interface SessionInput {
  bookingId: string;
  kind: 'acconto' | 'totale' | 'link';
  amount: number;
  title: string;
  description: string;
  email?: string;
  expiresInSec: number;
  successUrl: string;
  cancelUrl: string;
}

async function createSession(s: SessionInput) {
  const expiresAt = Math.floor(Date.now() / 1000) + s.expiresInSec;
  const session = await stripeRequest<{ id: string; url: string }>(STRIPE_KEY, 'POST', 'checkout/sessions', {
    mode: 'payment',
    locale: 'auto',
    client_reference_id: s.bookingId,
    customer_email: s.email || undefined,
    expires_at: expiresAt,
    success_url: s.successUrl,
    cancel_url: s.cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(s.amount * 100),
        product_data: { name: s.title, description: s.description },
      },
    }],
    metadata: { booking_id: s.bookingId, kind: s.kind },
    payment_intent_data: { description: `${s.title} - ${s.description}`, metadata: { booking_id: s.bookingId } },
  });
  const { error } = await db.from('payments').insert({
    booking_id: s.bookingId, kind: s.kind, amount: s.amount, stripe_session_id: session.id,
    checkout_url: session.url, expires_at: new Date(expiresAt * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return session;
}

async function checkout(body: Record<string, unknown>) {
  const { data, error } = await db.rpc('create_online_booking', {
    p_room: body.room_id, p_check_in: body.check_in, p_check_out: body.check_out,
    p_email: body.email, p_guests: body.guests ?? null, p_message: body.message ?? '', p_mode: body.mode,
    p_terms_accepted: body.terms_accepted === true,
  });
  if (error) return json({ error: error.message }, 400);
  const b = data[0];
  const kindLabel = body.mode === 'totale' ? 'saldo completo' : 'acconto';
  try {
    const session = await createSession({
      bookingId: b.booking_id,
      kind: body.mode as 'acconto' | 'totale',
      amount: Number(b.amount),
      title: `${b.room_name}: ${fmt(String(body.check_in))} - ${fmt(String(body.check_out))}`,
      description: `Prenotazione ${b.code}, ${kindLabel} (totale soggiorno ${Number(b.total).toFixed(2)} €)`,
      email: String(body.email),
      // il minimo consentito da Stripe è 30 minuti; il database tiene le date bloccate per 35
      expiresInSec: 30 * 60 + 30,
      successUrl: `${SITE_URL}/pagamento.html?b=${b.booking_id}&esito=ok`,
      cancelUrl: `${SITE_URL}/pagamento.html?b=${b.booking_id}&esito=annullato`,
    });
    return json({ url: session.url, booking_id: b.booking_id });
  } catch (e) {
    // senza pagina di pagamento la prenotazione non ha senso: si libera subito
    await db.from('bookings').delete().eq('id', b.booking_id);
    return json({ error: 'Pagamento non disponibile al momento: ' + (e as Error).message }, 502);
  }
}

async function cancel(body: Record<string, unknown>) {
  const id = String(body.booking_id ?? '');
  const { data: booking } = await db.from('bookings').select('id, status, amount_paid, payment_status, source')
    .eq('id', id).maybeSingle();
  if (!booking || booking.source !== 'sito' || booking.status !== 'richiesta' || Number(booking.amount_paid) > 0) {
    return json({ ok: false });
  }
  const { data: pays } = await db.from('payments').select('stripe_session_id')
    .eq('booking_id', id).eq('status', 'in_attesa');
  for (const p of pays ?? []) {
    try {
      // dopo "expire" la pagina Stripe non accetta più pagamenti: solo allora si liberano le date
      await stripeRequest(STRIPE_KEY, 'POST', `checkout/sessions/${p.stripe_session_id}/expire`);
    } catch {
      // già pagata o già scaduta: decide il webhook
      continue;
    }
    await db.rpc('expire_payment', { p_session: p.stripe_session_id });
  }
  return json({ ok: true });
}

async function link(body: Record<string, unknown>) {
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!(amount > 0 && amount <= 100000)) return json({ error: 'Importo non valido' }, 400);
  const { data: b } = await db.from('bookings').select('id, code, check_in, check_out, guest_email, rooms(name)')
    .eq('id', String(body.booking_id ?? '')).maybeSingle();
  if (!b) return json({ error: 'Prenotazione non trovata' }, 404);
  const roomName = (b.rooms as unknown as { name: string } | null)?.name ?? 'Camera';
  const session = await createSession({
    bookingId: b.id,
    kind: 'link',
    amount,
    title: `${roomName}: ${fmt(b.check_in)} - ${fmt(b.check_out)}`,
    description: `Pagamento soggiorno, prenotazione ${b.code}`,
    email: b.guest_email || undefined,
    expiresInSec: 23 * 3600,
    successUrl: `${SITE_URL}/pagamento.html?esito=ok&tipo=link`,
    cancelUrl: `${SITE_URL}/pagamento.html?esito=annullato&tipo=link`,
  });
  return json({ url: session.url });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!STRIPE_KEY || !SITE_URL) return json({ error: 'Pagamenti non configurati (STRIPE_SECRET_KEY / SITE_URL)' }, 500);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Richiesta non valida' }, 400); }

  try {
    if (body.action === 'checkout') return await checkout(body);
    if (body.action === 'cancel') return await cancel(body);
    if (body.action === 'link') {
      if (!(await hasRole(db, req, 'prenotazioni'))) return json({ error: 'non autorizzato' }, 401);
      return await link(body);
    }
    return json({ error: 'Azione sconosciuta' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
