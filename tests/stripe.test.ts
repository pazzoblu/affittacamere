// Esecuzione: node --test "tests/*.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeForm, verifyStripeSignature, hmacSha256Hex } from '../supabase/functions/_shared/stripe.ts';

test('codifica i parametri annidati nel formato Stripe', () => {
  const body = encodeForm({
    mode: 'payment',
    customer_email: undefined,
    expires_at: 1700000000,
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 7650, product_data: { name: 'Camera Blu: 1 nov - 3 nov' } } }],
    metadata: { booking_id: 'abc' },
  });
  assert.equal(body, [
    'mode=payment',
    'expires_at=1700000000',
    'line_items%5B0%5D%5Bquantity%5D=1',
    'line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=eur',
    'line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=7650',
    'line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bname%5D=Camera%20Blu%3A%201%20nov%20-%203%20nov',
    'metadata%5Bbooking_id%5D=abc',
  ].join('&'));
});

test('accetta solo webhook firmati con il segreto giusto e recenti', async () => {
  const secret = 'whsec_test';
  const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
  const t = 1761300000;
  const sig = await hmacSha256Hex(secret, `${t}.${payload}`);
  const header = `t=${t},v1=deadbeef,v1=${sig}`;

  assert.equal(await verifyStripeSignature(payload, header, secret, 300, t + 10), true);
  assert.equal(await verifyStripeSignature(payload + ' ', header, secret, 300, t + 10), false, 'corpo alterato');
  assert.equal(await verifyStripeSignature(payload, header, 'whsec_altro', 300, t + 10), false, 'segreto sbagliato');
  assert.equal(await verifyStripeSignature(payload, header, secret, 300, t + 1000), false, 'troppo vecchio');
  assert.equal(await verifyStripeSignature(payload, null, secret), false, 'senza header');
});

test('la firma HMAC coincide con il vettore noto di RFC 4231 (caso 2)', async () => {
  assert.equal(await hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});
