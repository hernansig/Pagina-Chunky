import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody } from '../lib/http.js';
import { limpiar } from '../lib/util.js';
import { permitido, ipDe } from '../lib/ratelimit.js';

// /api/pedido — operaciones públicas sobre un pedido por código:
//   GET  ?codigo=CHK-XXXXXX  → rastreo (info no sensible)
//   POST { codigo }          → liberar la reserva de stock si el cliente
//                              volvió a la web sin completar el pago
export default async function handler(req, res) {
  if (req.method === 'GET') return rastrear(req, res);
  if (req.method === 'POST') return liberar(req, res);
  return methodNotAllowed(req, res, ['GET', 'POST']);
}

// ── Rastreo público ───────────────────────────────────────────
async function rastrear(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const codigo = (url.searchParams.get('codigo') || '').trim().toUpperCase();
    if (!codigo) return fail(res, 400, 'Falta el código.');

    const { data, error } = await supa()
      .from('pedidos')
      .select('codigo_publico,productos,monto_total,estado_pago,estado_envio,created_at')
      .eq('codigo_publico', codigo)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'No encontramos ese código.');

    json(res, 200, {
      ok: true,
      pedido: {
        codigo: data.codigo_publico,
        productos: (data.productos || []).map((p) => ({ nombre: p.nombre, variante: p.variante || null, cantidad: p.cantidad || 1 })),
        monto_total: data.monto_total,
        estado_pago: data.estado_pago,
        estado_envio: data.estado_envio,
        created_at: data.created_at,
      },
    });
  } catch (err) {
    console.error('[pedido]', err.message);
    fail(res, 500, 'No se pudo consultar el pedido.');
  }
}

// ── Liberar reserva al volver sin pagar ───────────────────────
// Lo llama la página cuando MercadoPago devuelve al cliente por "cancelado".
// Solo actúa sobre pedidos PENDIENTES con stock reservado; el claim es atómico
// (no libera dos veces). Si el cliente igual termina pagando después, el webhook
// vuelve a descontar el stock (self-heal), así que soltarlo acá es seguro.
async function liberar(req, res) {
  try {
    if (!(await permitido(`liberar:${ipDe(req)}`, 600, 30))) {
      return fail(res, 429, 'Demasiadas solicitudes. Esperá un momento.');
    }
    const body = await readBody(req);
    const codigo = limpiar(body.codigo, 20).toUpperCase();
    if (!codigo) return fail(res, 400, 'Falta el código.');

    const sb = supa();
    const { data: pedido } = await sb.from('pedidos')
      .select('id,estado_pago,stock_reservado,productos')
      .eq('codigo_publico', codigo).maybeSingle();
    // No revelamos si el código existe o no: siempre 200.
    if (!pedido || pedido.estado_pago !== 'pendiente' || !pedido.stock_reservado) {
      return json(res, 200, { ok: true });
    }

    const { data: claim } = await sb.from('pedidos')
      .update({ estado_pago: 'rechazado', stock_reservado: false })
      .eq('id', pedido.id).eq('estado_pago', 'pendiente').eq('stock_reservado', true)
      .select('id');
    if (claim && claim.length) {
      for (const it of pedido.productos || []) {
        if (it.variante_id) await sb.rpc('devolver_stock_variante', { p_variante_id: it.variante_id, p_cantidad: it.cantidad || 1 });
        else await sb.rpc('devolver_stock', { p_producto_id: it.producto_id, p_cantidad: it.cantidad || 1 });
      }
    }
    json(res, 200, { ok: true });
  } catch (err) {
    console.error('[pedido] liberar', err.message);
    json(res, 200, { ok: true });   // liberar es best-effort; el cron es la red de seguridad
  }
}
