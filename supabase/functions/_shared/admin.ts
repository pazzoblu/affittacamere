import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// true se la richiesta porta il token di un utente presente nella tabella admins
export async function isAdminRequest(db: SupabaseClient, req: Request): Promise<boolean> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return false;
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  return !!admin;
}
