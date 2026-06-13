import { createClient } from '@supabase/supabase-js';

// Cliente con service_role: SOLO se usa en el backend (Vercel Functions).
// Ignora RLS, así que nunca debe exponerse al frontend.
let _client = null;

export function supa() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}
