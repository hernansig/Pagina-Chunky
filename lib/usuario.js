import { supa } from './supabase.js';

// Lee el access_token (Bearer) del request y lo valida contra Supabase Auth.
// Devuelve el usuario de auth ({ id, email, user_metadata }) o null.
export async function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  try {
    const { data, error } = await supa().auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

// Garantiza que exista la fila en `usuarios` para este usuario de auth
// (red de seguridad por si el trigger no corrió). Devuelve la fila.
export async function ensureUsuario(authUser) {
  const sb = supa();
  const meta = authUser.user_metadata || {};
  const alias = meta.name || (authUser.email || '').split('@')[0] || 'jugador';
  const nombre = meta.full_name || meta.name || null;
  const avatar = meta.avatar_url || meta.picture || null;

  // Crea si no existe (sin pisar puntos/alias ya guardados).
  await sb.from('usuarios').upsert(
    { id: authUser.id, email: authUser.email, nombre, alias, avatar_url: avatar },
    { onConflict: 'id', ignoreDuplicates: true }
  );

  const { data, error } = await sb.from('usuarios').select('*').eq('id', authUser.id).maybeSingle();
  if (error) throw error;
  return data;
}

// Atajo: valida el token y devuelve la fila de usuarios (o null si no hay sesión).
export async function usuarioDeReq(req) {
  const authUser = await getAuthUser(req);
  if (!authUser) return null;
  return ensureUsuario(authUser);
}
