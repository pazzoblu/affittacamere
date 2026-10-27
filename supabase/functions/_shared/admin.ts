import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// livello di accesso scritto nel token: "aal2" se l'utente ha inserito anche il codice della verifica in due passaggi
export function tokenAal(token: string): string {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).aal ?? '';
  } catch {
    return '';
  }
}

// true se la richiesta porta il token di un utente dello staff con quel ruolo (l'admin li ha tutti),
// entrato con la verifica in due passaggi
export async function hasRole(db: SupabaseClient, req: Request, role: string): Promise<boolean> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || tokenAal(token) !== 'aal2') return false;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return false;
  const { data: staff } = await db.from('staff').select('roles').eq('user_id', data.user.id).maybeSingle();
  const roles: string[] = staff?.roles ?? [];
  return roles.includes('admin') || roles.includes(role);
}
