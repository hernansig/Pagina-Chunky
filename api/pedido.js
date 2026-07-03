import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed } from '../lib/http.js';

// GET /api/pedido?codigo=CHK-XXXXXX — rastreo público (info no sensible).
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'GET')) return;
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
