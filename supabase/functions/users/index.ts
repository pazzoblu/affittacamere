// Gestione degli utenti dell'area riservata, solo per gli amministratori.
// Azioni: list, create (con password o con link di attivazione), update (nome e ruoli),
// new_link (nuovo link per scegliere la password), set_password, delete.
// I link non vengono spediti da Supabase: li mostra l'area riservata e l'admin li inoltra.
// Il database impedisce comunque di togliere l'ultimo amministratore.
// File autosufficiente: si può pubblicare anche dall'editor della Dashboard Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// chiave segreta: quella "service_role" classica oppure, nei progetti con le nuove chiavi API,
// la prima di SUPABASE_SECRET_KEYS (JSON con le chiavi sb_secret_...)
function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return (Array.isArray(keys) ? keys[0] : Object.values(keys)[0]) as string;
  } catch {
    return '';
  }
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ROLES = ['admin', 'camere', 'prenotazioni', 'prezzi'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// restituisce l'id dell'amministratore che chiama, oppure null
async function callerAdmin(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  const { data: me } = await db.from('staff').select('roles').eq('user_id', data.user.id).maybeSingle();
  return me?.roles?.includes('admin') ? data.user.id : null;
}

function cleanRoles(roles: unknown): string[] {
  return Array.isArray(roles) ? [...new Set(roles.filter(r => ROLES.includes(r)))] : [];
}

async function list() {
  const { data: auth, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const { data: staff } = await db.from('staff').select('user_id, name, roles');
  const byId = new Map((staff ?? []).map(s => [s.user_id, s]));
  return auth.users.map(u => ({
    id: u.id,
    email: u.email,
    name: byId.get(u.id)?.name ?? '',
    roles: byId.get(u.id)?.roles ?? [],
    staff: byId.has(u.id),
    // ha ricevuto il link di attivazione ma non ha ancora scelto la password
    pending: !u.email_confirmed_at,
    last_sign_in_at: u.last_sign_in_at,
    created_at: u.created_at,
  })).sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
}

// indirizzo dell'area riservata a cui riporta il link dell'email (deve essere tra i Redirect URLs di Supabase)
function redirectTo(body: Record<string, unknown>): string | undefined {
  const url = String(body.redirect_to ?? '');
  return /^https?:\/\//.test(url) ? url : undefined;
}

// Link da inoltrare all'utente (WhatsApp, email...): Supabase non invia nulla, quindi non serve un server SMTP.
// "invite" crea anche l'utente; "recovery" serve per chi esiste già.
async function actionLink(type: 'invite' | 'recovery', email: string, body: Record<string, unknown>) {
  const { data, error } = await db.auth.admin.generateLink({ type, email, options: { redirectTo: redirectTo(body) } });
  if (error) throw error;
  return { userId: data.user.id, link: data.properties.action_link };
}

// senza password: si genera il link di attivazione con cui l'utente sceglie la password
async function create(body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const name = String(body.name ?? '').trim().slice(0, 100);
  const roles = cleanRoles(body.roles);
  if (!EMAIL.test(email)) return json({ error: 'Email non valida' }, 400);
  if (password && password.length < 8) return json({ error: 'La password deve avere almeno 8 caratteri' }, 400);
  if (!roles.length) return json({ error: 'Scegli almeno un ruolo' }, 400);

  let userId: string;
  let link: string | undefined;
  try {
    if (password) {
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      userId = data.user.id;
    } else {
      ({ userId, link } = await actionLink('invite', email, body));
    }
  } catch (e) {
    const message = (e as Error).message;
    return json({ error: /already/i.test(message) ? 'Esiste già un utente con questa email' : message }, 400);
  }
  const { error: staffErr } = await db.from('staff').insert({ user_id: userId, email, name, roles });
  if (staffErr) {
    await db.auth.admin.deleteUser(userId);
    return json({ error: staffErr.message }, 500);
  }
  return json({ id: userId, link });
}

// nuovo link per scegliere la password (anche per chi non ha mai usato il link di attivazione)
async function newLink(body: Record<string, unknown>) {
  const { data: u, error: uErr } = await db.auth.admin.getUserById(String(body.user_id ?? ''));
  if (uErr || !u.user?.email) return json({ error: 'Utente non trovato' }, 404);
  try {
    const { link } = await actionLink('recovery', u.user.email, body);
    return json({ link });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}

// nome e ruoli; crea il profilo anche per utenti nati fuori dall'area riservata (es. dalla Dashboard)
async function update(body: Record<string, unknown>) {
  const id = String(body.user_id ?? '');
  const roles = cleanRoles(body.roles);
  if (!roles.length) return json({ error: 'Scegli almeno un ruolo' }, 400);
  const { data: u, error: uErr } = await db.auth.admin.getUserById(id);
  if (uErr || !u.user) return json({ error: 'Utente non trovato' }, 404);
  const { error } = await db.from('staff').upsert({
    user_id: id, email: u.user.email ?? '', name: String(body.name ?? '').trim().slice(0, 100), roles,
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function setPassword(body: Record<string, unknown>) {
  const password = String(body.password ?? '');
  if (password.length < 8) return json({ error: 'La password deve avere almeno 8 caratteri' }, 400);
  const { error } = await db.auth.admin.updateUserById(String(body.user_id ?? ''), { password });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function remove(body: Record<string, unknown>, me: string) {
  const id = String(body.user_id ?? '');
  if (id === me) return json({ error: 'Non puoi eliminare il tuo utente' }, 400);
  // prima il profilo staff: se è l'ultimo admin il database rifiuta e l'utente resta
  const { error: staffErr } = await db.from('staff').delete().eq('user_id', id);
  if (staffErr) return json({ error: staffErr.message }, 400);
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const me = await callerAdmin(req);
  if (!me) return json({ error: 'Solo gli amministratori possono gestire gli utenti' }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Richiesta non valida' }, 400); }

  try {
    switch (body.action) {
      case 'list': return json({ users: await list() });
      case 'create': return await create(body);
      case 'update': return await update(body);
      case 'new_link': return await newLink(body);
      case 'set_password': return await setPassword(body);
      case 'delete': return await remove(body, me);
      default: return json({ error: 'Azione sconosciuta' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
