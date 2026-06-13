import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody, isEmail } from '../lib/http.js';
import { crearPreferencia } from '../lib/mercadopago.js';
import { generarCodigoPedido } from '../lib/util.js';

// POST /api/crear-pago
// body: { producto_id, cantidad?, nombre?, email }
// Crea un pedido en estado "pendiente" y devuelve el init_point de MercadoPago.
// El stock NO se descuenta acá: la única fuente de verdad es el webhook.
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'POST')) return;
  try {
    const body = await readBody(req);
    const productoId = body.producto_id;
    const cantidad = Math.max(1, parseInt(body.cantidad, 10) || 1);
    const email = (body.email || '').trim();
    const nombre = (body.nombre || '').trim() || null;

    if (!productoId) return fail(res, 400, 'Falta el producto.');
    if (!isEmail(email)) return fail(res, 400, 'Email inválido.');

    const sb = supa();
    const { data: producto, error: e1 } = await sb
      .from('productos')
      .select('id,nombre,precio,stock_disponible,activo')
      .eq('id', productoId)
      .maybeSingle();
    if (e1) throw e1;
    if (!producto || !producto.activo) return fail(res, 404, 'Producto no disponible.');
    if (producto.stock_disponible < cantidad) return fail(res, 409, 'Sin stock disponible.');

    const codigo = generarCodigoPedido();
    const itemPedido = {
      producto_id: producto.id,
      nombre: producto.nombre,
      precio: Number(producto.precio),
      cantidad,
    };
    const montoTotal = Number(producto.precio) * cantidad;

    const { data: pedido, error: e2 } = await sb
      .from('pedidos')
      .insert({
        codigo_publico: codigo,
        cliente_nombre: nombre,
        cliente_contacto: email,
        productos: [itemPedido],
        monto_total: montoTotal,
        estado_pago: 'pendiente',
        estado_envio: 'preparando',
      })
      .select('id,codigo_publico')
      .single();
    if (e2) throw e2;

    const pref = await crearPreferencia({
      items: [{ id: producto.id, nombre: producto.nombre, precio: Number(producto.precio), cantidad }],
      codigoPedido: codigo,
      payerEmail: email,
    });

    await sb.from('pedidos').update({ mp_preference_id: pref.id }).eq('id', pedido.id);

    json(res, 200, { ok: true, codigo, init_point: pref.init_point });
  } catch (err) {
    console.error('[crear-pago]', err.message);
    fail(res, 500, 'No se pudo iniciar el pago.');
  }
}
