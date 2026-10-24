// Riceve gli eventi di Stripe e aggiorna pagamenti e prenotazioni.
// In Stripe: Developers > Webhooks > endpoint .../functions/v1/stripe-webhook con gli eventi
// checkout.session.completed, checkout.session.async_payment_succeeded,
// checkout.session.async_payment_failed, checkout.session.expired
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyStripeSignature } from '../_shared/stripe.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

Deno.serve(async req => {
  const payload = await req.text();
  if (!SECRET || !(await verifyStripeSignature(payload, req.headers.get('Stripe-Signature'), SECRET))) {
    return new Response('firma non valida', { status: 400 });
  }

  const event = JSON.parse(payload);
  const session = event.data?.object ?? {};
  let error = null;

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      // con bonifici o altri metodi differiti "completed" arriva prima dell'incasso: si aspetta "succeeded"
      if (session.payment_status === 'paid') {
        ({ error } = await db.rpc('register_payment', { p_session: session.id, p_intent: session.payment_intent ?? null }));
      }
      break;
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      ({ error } = await db.rpc('expire_payment', { p_session: session.id }));
      break;
  }

  // con un errore Stripe ritenta l'invio più tardi
  if (error) return new Response(error.message, { status: 500 });
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
