// Gestione degli utenti dell'area riservata, solo per gli amministratori.
// Azioni: list, create, update (nome e ruoli), set_password, delete.
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

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
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
    last_sign_in_at: u.last_sign_in_at,
    created_at: u.created_at,
  })).sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
}

async function create(body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const name = String(body.name ?? '').trim().slice(0, 100);
  const roles = cleanRoles(body.roles);
  if (!EMAIL.test(email)) return json({ error: 'Email non valida' }, 400);
  if (password.length < 8) return json({ error: 'La password deve avere almeno 8 caratteri' }, 400);
  if (!roles.length) return json({ error: 'Scegli almeno un ruolo' }, 400);

  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    const exists = /already/i.test(error.message);
    return json({ error: exists ? 'Esiste già un utente con questa email' : error.message }, 400);
  }
  const { error: staffErr } = await db.from('staff').insert({ user_id: data.user.id, email, name, roles });
  if (staffErr) {
    await db.auth.admin.deleteUser(data.user.id);
    return json({ error: staffErr.message }, 500);
  }
  return json({ id: data.user.id });
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
      case 'set_password': return await setPassword(body);
      case 'delete': return await remove(body, me);
      default: return json({ error: 'Azione sconosciuta' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
