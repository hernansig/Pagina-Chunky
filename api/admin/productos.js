import { supa } from '../../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';

// /api/admin/productos
//   GET    → todos (activos e inactivos)
//   POST   → crear { nombre, precio, foto_url?, talle?, stock_total?, ... }
//   PATCH  → editar { id, ...campos }
//   DELETE → { id }
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  if (requireAdmin(req, res)) return;
  const sb = supa();

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb.from('productos').select('*')
        .order('orden', { ascending: true }).order('created_at', { ascending: true });
      if (error) throw error;
      return json(res, 200, { ok: true, productos: data || [] });
    }

    const body = await readBody(req);

    if (req.method === 'POST') {
      if (!body.nombre || body.precio == null) return fail(res, 400, 'Nombre y precio son obligatorios.');
      const stockTotal = parseInt(body.stock_total, 10);
      const total = Number.isFinite(stockTotal) ? stockTotal : 1;
      const fila = {
        nombre: String(body.nombre).trim(),
        precio: Number(body.precio),
        foto_url: body.foto_url || null,
        talle: body.talle || null,
        stock_total: total,
        stock_disponible: total,
        stock_reservado: 0,
        activo: body.activo !== false,
        orden: parseInt(body.orden, 10) || 0,
      };
      const { data, error } = await sb.from('productos').insert(fila).select('id').single();
      if (error) throw error;
      return json(res, 200, { ok: true, id: data.id });
    }

    if (req.method === 'PATCH') {
      if (!body.id) return fail(res, 400, 'Falta el id.');
      const permitidos = ['nombre', 'precio', 'foto_url', 'talle', 'stock_total', 'stock_disponible', 'stock_reservado', 'activo', 'orden'];
      const update = {};
      for (const k of permitidos) if (k in body) update[k] = body[k];
      if (!Object.keys(update).length) return fail(res, 400, 'Nada para actualizar.');
      const { error } = await sb.from('productos').update(update).eq('id', body.id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    // DELETE
    if (!body.id) return fail(res, 400, 'Falta el id.');
    const { error } = await sb.from('productos').delete().eq('id', body.id);
    if (error) throw error;
    json(res, 200, { ok: true });
  } catch (err) {
    console.error('[admin/productos]', err.message);
    fail(res, 500, 'Error en productos.');
  }
}
