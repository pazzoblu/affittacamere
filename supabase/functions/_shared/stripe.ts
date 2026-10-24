// Chiamate minime all'API Stripe senza SDK: form-encoding dei parametri e verifica della firma dei webhook.

type Params = { [key: string]: string | number | boolean | null | undefined | Params | Params[] };

// { a: { b: 1 }, c: [{ d: 2 }] } -> "a[b]=1&c[0][d]=2" (formato richiesto dall'API Stripe)
export function encodeForm(params: Params): string {
  const out: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Params)) walk(v, key ? `${key}[${k}]` : k);
    } else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  walk(params, '');
  return out.join('&');
}

export async function stripeRequest<T = Record<string, unknown>>(
  secretKey: string, method: 'GET' | 'POST', path: string, params?: Params,
): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? encodeForm(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe ha risposto ${res.status}`);
  return data as T;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

// Header "Stripe-Signature: t=1700000000,v1=abc...,v1=def..." firmato su "<t>.<corpo grezzo>"
export async function verifyStripeSignature(
  payload: string, header: string | null, secret: string, toleranceSec = 300, nowSec = Date.now() / 1000,
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${payload}`);
  return sigs.some(s => safeEqual(s, expected));
}
