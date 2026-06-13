import { fail } from '../lib/http.js';
import { validarFirmaWebhook, obtenerPago } from '../lib/mercadopago.js';
import { supa } from '../lib/supabase.js';
import { enviarMail, avisarDueno, plantilla } from '../lib/mail.js';

// POST /api/webhook — notificaciones de MercadoPago.
// REGLA CLAVE: solo este endpoint marca un pedido como "pagado".
// El redirect del usuario nunca confirma el pago.
export default async function handler(req, res) {
  // MP a veces hace GET de prueba: responder 200.
  if (req.method !== 'POST') { res.statusCode = 200; return res.end('ok'); }

  const url = new URL(req.url, 'http://x');
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const type = body.type || url.searchParams.get('type') || url.searchParams.get('topic');
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('id') || body?.data?.id;

  // 1) Validar la firma. Si no es válida → 401 (no confiar en el payload).
  const firma = validarFirmaWebhook({ xSignature, xRequestId, dataId });
  if (!firma.ok) {
    console.warn('[webhook] firma inválida:', firma.motivo);
    return fail(res, 401, 'firma inválida');
  }

  // 2) Solo procesamos notificaciones de pago.
  if (type !== 'payment' || !dataId) {
    res.statusCode = 200;
    return res.end('ignored');
  }

  try {
    // 3) Consultar el pago real en MP (fuente de verdad).
    const pago = await obtenerPago(dataId);
    const codigo = pago.external_reference;
    const estado = pago.status; // approved / rejected / cancelled / pending ...
    if (!codigo) { res.statusCode = 200; return res.end('sin referencia'); }

    const sb = supa();
    const { data: pedido, error } = await sb
      .from('pedidos')
      .select('*')
      .eq('codigo_publico', codigo)
      .maybeSingle();
    if (error) throw error;
    if (!pedido) { res.statusCode = 200; return res.end('pedido inexistente'); }

    if (estado === 'approved') {
      // Idempotencia: si ya estaba pagado, no volver a descontar stock.
      if (pedido.estado_pago === 'pagado') { res.statusCode = 200; return res.end('ya procesado'); }

      await sb.from('pedidos')
        .update({ estado_pago: 'pagado', mp_payment_id: String(dataId) })
        .eq('id', pedido.id);

      // Descontar stock de cada producto (función atómica).
      for (const item of pedido.productos || []) {
        await sb.rpc('descontar_stock', {
          p_producto_id: item.producto_id,
          p_cantidad: item.cantidad || 1,
        });
      }
      // Marcar reservas activas de esos productos como convertidas.
      for (const item of pedido.productos || []) {
        await sb.from('reservas')
          .update({ estado: 'convertida_en_pedido' })
          .eq('producto_id', item.producto_id)
          .eq('cliente_contacto', pedido.cliente_contacto)
          .eq('estado', 'activa');
      }

      await notificarPagoConfirmado(pedido);
    } else if (estado === 'rejected' || estado === 'cancelled') {
      await sb.from('pedidos')
        .update({ estado_pago: 'rechazado', mp_payment_id: String(dataId) })
        .eq('id', pedido.id);
    }
    // pending / in_process: no cambiamos nada, esperamos otra notificación.

    res.statusCode = 200;
    res.end('ok');
  } catch (err) {
    console.error('[webhook]', err.message);
    // 500 → MP reintenta (cubre errores transitorios de DB/red).
    fail(res, 500, 'error procesando');
  }
}

async function notificarPagoConfirmado(pedido) {
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const lista = (pedido.productos || [])
    .map((p) => `${p.nombre}${p.talle ? ` (T ${p.talle})` : ''} × ${p.cantidad || 1}`)
    .join('<br>');

  // Cliente
  if (pedido.cliente_contacto) {
    await enviarMail({
      to: pedido.cliente_contacto,
      subject: `Pago confirmado — pedido ${pedido.codigo_publico}`,
      html: plantilla({
        titulo: 'Pago confirmado',
        cuerpoHtml: `
          Recibimos tu pago. Tu pedido está en preparación.<br><br>
          <b>Código:</b> ${pedido.codigo_publico}<br>
          <b>Productos:</b><br>${lista}<br><br>
          Envío estimado: 3 a 4 días hábiles. Podés seguir el estado con tu código.`,
        cta: { texto: 'Ver mi pedido', url: `${site}/pedido/${pedido.codigo_publico}` },
      }),
    });
  }

  // Dueño
  await avisarDueno({
    subject: `NUEVA VENTA — ${pedido.codigo_publico} ($${pedido.monto_total})`,
    html: plantilla({
      titulo: 'Nueva venta confirmada',
      cuerpoHtml: `
        <b>Código:</b> ${pedido.codigo_publico}<br>
        <b>Cliente:</b> ${pedido.cliente_nombre || '—'} (${pedido.cliente_contacto || '—'})<br>
        <b>Total:</b> $${pedido.monto_total}<br>
        <b>Productos:</b><br>${lista}`,
    }),
  });
}
