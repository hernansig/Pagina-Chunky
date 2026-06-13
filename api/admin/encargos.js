import { supa } from '../../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';

// /api/admin/encargos
//   GET   → lista de encargos
//   PATCH → { id, estado }  (pendiente / cotizado / confirmado)
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, ['GET', 'PATCH'])) return;
  if (requireAdmin(req, res)) return;
  const sb = supa();

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb.from('encargos').select('*')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(res, 200, { ok: true, encargos: data || [] });
    }

    const { id, estado } = await readBody(req);
    const validos = ['pendiente', 'cotizado', 'confirmado'];
    if (!id || !validos.includes(estado)) return fail(res, 400, 'Datos inválidos.');
    const { error } = await sb.from('encargos').update({ estado }).eq('id', id);
    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (err) {
    console.error('[admin/encargos]', err.message);
    fail(res, 500, 'Error en encargos.');
  }
}
