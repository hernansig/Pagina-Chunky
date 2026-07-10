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
      // Defensa en profundidad: el monto pagado debe coincidir con el total.
      const pagado = Number(pago.transaction_amount);
      const esperado = Number(pedido.monto_total);
      if (isFinite(pagado) && isFinite(esperado) && Math.abs(pagado - esperado) > 1) {
        console.warn('[webhook] monto no coincide', { codigo, pagado, esperado });
        await avisarDueno({
          subject: `⚠ Pago con monto distinto — ${codigo}`,
          html: plantilla({
            titulo: 'Revisar pago',
            cuerpoHtml: `El pago del pedido <b>${codigo}</b> fue de <b>$${pagado}</b> pero el total del pedido es <b>$${esperado}</b>.<br>
              No se confirmó automáticamente. Revisalo en MercadoPago antes de enviar.`,
          }),
        });
        res.statusCode = 200; return res.end('monto no coincide');
      }

      // Idempotencia ATÓMICA: un solo webhook "gana" el marcado a pagado.
      // (check-then-update no atómico permitía descontar stock dos veces).
      const { data: claim } = await sb.from('pedidos')
        .update({ estado_pago: 'pagado', mp_payment_id: String(dataId), stock_reservado: false })
        .eq('id', pedido.id).neq('estado_pago', 'pagado').select('id');
      if (!claim || !claim.length) { res.statusCode = 200; return res.end('ya procesado'); }

      // Stock: si se reservó al crear la orden, ya está descontado. Si no
      // (orden vieja, o pago tardío sobre una orden liberada), se descuenta
      // ahora de forma condicional; si faltara stock, se avisa al dueño.
      if (!pedido.stock_reservado) {
        const sinStock = [];
        for (const item of pedido.productos || []) {
          const r = item.variante_id
            ? await sb.rpc('reservar_stock_variante', { p_variante_id: item.variante_id, p_cantidad: item.cantidad || 1 })
            : await sb.rpc('reservar_stock', { p_producto_id: item.producto_id, p_cantidad: item.cantidad || 1 });
          if (r.data !== true) sinStock.push(item);
        }
        if (sinStock.length) {
          await avisarDueno({
            subject: `⚠ Venta sin stock — ${codigo}`,
            html: plantilla({
              titulo: 'Venta confirmada sin stock',
              cuerpoHtml: `El pedido <b>${codigo}</b> se pagó pero algún producto ya no tenía stock:
                <br>${sinStock.map((i) => `${i.nombre}${i.variante ? ` (${i.variante})` : ''}`).join('<br>')}<br>
                Revisá disponibilidad antes de enviar.`,
            }),
          });
        }
      }

      // Finalizar el cupón usado (por si una carrera lo dejó suelto): queda usado.
      if (pedido.cupon_codigo) {
        await sb.from('items_usuario').update({ usado_en: new Date().toISOString() })
          .eq('codigo', pedido.cupon_codigo).is('usado_en', null);
      }

      // Marcar reservas (24h) activas de esos productos como convertidas.
      for (const item of pedido.productos || []) {
        await sb.from('reservas')
          .update({ estado: 'convertida_en_pedido' })
          .eq('producto_id', item.producto_id)
          .eq('cliente_contacto', pedido.cliente_contacto)
          .eq('estado', 'activa');
      }

      // Asociar el pedido al usuario si su email coincide (compra anónima si no).
      if (pedido.cliente_contacto && !pedido.usuario_id) {
        try {
          const { data: usuario } = await sb
            .from('usuarios').select('id')
            .eq('email', pedido.cliente_contacto).maybeSingle();
          if (usuario) await sb.from('pedidos').update({ usuario_id: usuario.id }).eq('id', pedido.id);
        } catch (e) {
          console.warn('[webhook] no se pudo asociar usuario:', e.message);
        }
      }

      await notificarPagoConfirmado(pedido);
    } else if (estado === 'rejected' || estado === 'cancelled') {
      // Soltar la reserva de stock de forma atómica (solo un webhook la devuelve).
      const { data: claim } = await sb.from('pedidos')
        .update({ estado_pago: 'rechazado', mp_payment_id: String(dataId), stock_reservado: false })
        .eq('id', pedido.id).eq('stock_reservado', true).select('id');
      if (claim && claim.length) {
        await devolverStock(sb, pedido.productos);
        // el cupón vuelve a quedar disponible para el usuario
        if (pedido.cupon_codigo) await sb.from('items_usuario').update({ usado_en: null }).eq('codigo', pedido.cupon_codigo);
      } else {
        // sin reserva que soltar; marcar rechazado solo si seguía pendiente
        await sb.from('pedidos')
          .update({ estado_pago: 'rechazado', mp_payment_id: String(dataId) })
          .eq('id', pedido.id).eq('estado_pago', 'pendiente');
      }
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

// Devuelve al stock lo que un pedido tenía reservado (pago rechazado).
async function devolverStock(sb, items) {
  for (const it of items || []) {
    if (it.variante_id) await sb.rpc('devolver_stock_variante', { p_variante_id: it.variante_id, p_cantidad: it.cantidad || 1 });
    else await sb.rpc('devolver_stock', { p_producto_id: it.producto_id, p_cantidad: it.cantidad || 1 });
  }
}

async function notificarPagoConfirmado(pedido) {
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const lista = (pedido.productos || [])
    .map((p) => `${p.nombre}${p.variante ? ` (${p.variante})` : p.talle ? ` (T ${p.talle})` : ''} × ${p.cantidad || 1}`)
    .join('<br>');
  // Desglose de envío/descuento (cupón).
  const envio = Number(pedido.envio || 0), desc = Number(pedido.descuento || 0);
  const desglose =
    `${desc > 0 ? `<b>Descuento:</b> -$${desc}${pedido.cupon_codigo ? ` (cupón ${pedido.cupon_codigo})` : ''}<br>` : ''}` +
    `<b>Envío:</b> ${envio > 0 ? '$' + envio : 'GRATIS' + (pedido.cupon_codigo ? ` (cupón ${pedido.cupon_codigo})` : '')}<br>`;

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
          <b>Productos:</b><br>${lista}<br>
          ${desglose}
          <b>Total:</b> $${pedido.monto_total}<br><br>
          Envío estimado: 3 a 4 días hábiles. Podés seguir el estado con tu código.`,
        cta: { texto: 'Ver mi pedido', url: `${site}/pedido/${pedido.codigo_publico}` },
      }),
    });
  }

  // Dueño
  const dir = pedido.direccion_envio || {};
  const dirHtml = dir.calle
    ? `${dir.calle}<br>${dir.ciudad || ''}${dir.departamento ? ', ' + dir.departamento : ''}${dir.cp ? ' (CP ' + dir.cp + ')' : ''}<br>
       Tel: ${dir.telefono || '—'}${dir.notas ? '<br>Ref: ' + dir.notas : ''}`
    : '—';
  await avisarDueno({
    subject: `NUEVA VENTA — ${pedido.codigo_publico} ($${pedido.monto_total})`,
    html: plantilla({
      titulo: 'Nueva venta confirmada',
      cuerpoHtml: `
        <b>Código:</b> ${pedido.codigo_publico}<br>
        <b>Cliente:</b> ${pedido.cliente_nombre || '—'} (${pedido.cliente_contacto || '—'})<br>
        <b>Productos:</b><br>${lista}<br>
        ${desglose}
        <b>Total:</b> $${pedido.monto_total}<br><br>
        <b>Enviar a:</b><br>${dirHtml}`,
    }),
  });
}
