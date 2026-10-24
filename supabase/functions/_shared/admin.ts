import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// true se la richiesta porta il token di un utente dello staff con quel ruolo (l'admin li ha tutti)
export async function hasRole(db: SupabaseClient, req: Request, role: string): Promise<boolean> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return false;
  const { data: staff } = await db.from('staff').select('roles').eq('user_id', data.user.id).maybeSingle();
  const roles: string[] = staff?.roles ?? [];
  return roles.includes('admin') || roles.includes(role);
}
