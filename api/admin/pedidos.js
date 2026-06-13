import { supa } from '../../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';

// /api/admin/pedidos
//   GET   → lista de pedidos
//   PATCH → { id, estado_envio }  (cambia el estado de envío)
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, ['GET', 'PATCH'])) return;
  if (requireAdmin(req, res)) return;
  const sb = supa();

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb
        .from('pedidos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return json(res, 200, { ok: true, pedidos: data || [] });
    }

    // PATCH
    const { id, estado_envio } = await readBody(req);
    const validos = ['preparando', 'enviado', 'entregado'];
    if (!id || !validos.includes(estado_envio)) return fail(res, 400, 'Datos inválidos.');

    const update = { estado_envio };
    // Registrar cuándo pasó a "enviado" (lo usa el cron de reseñas).
    if (estado_envio === 'enviado') update.enviado_at = new Date().toISOString();

    const { error } = await sb.from('pedidos').update(update).eq('id', id);
    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (err) {
    console.error('[admin/pedidos]', err.message);
    fail(res, 500, 'Error en pedidos.');
  }
}
