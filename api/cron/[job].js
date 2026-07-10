import { supa } from '../../lib/supabase.js';
import { json, fail } from '../../lib/http.js';
import { requireCron } from '../../lib/auth.js';
import { enviarMail, plantilla } from '../../lib/mail.js';
import { firmaCorta } from '../../lib/util.js';

// Función única para /api/cron/* (liberar-reservas, resenas).
// Vercel cuenta esto como 1 sola función.
export default async function handler(req, res) {
  if (requireCron(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const job = (req.query && req.query.job) || url.pathname.split('/').pop();
  try {
    if (job === 'liberar-reservas') return await liberarReservas(res);
    if (job === 'resenas') return await cronResenas(res);
    return fail(res, 404, 'Cron desconocido.');
  } catch (err) {
    console.error('[cron]', job, err.message);
    fail(res, 500, 'error en cron');
  }
}

// ── liberar-reservas ──────────────────────────────────────────
async function liberarReservas(res) {
  const sb = supa();
  const ahora = new Date();
  let vencidas = 0, recordatorios = 0, checkoutsLiberados = 0;

  // Checkouts abandonados: pedidos pendientes con stock reservado cuyo plazo
  // venció → devolver el stock y marcar el pedido como rechazado. El claim es
  // atómico (por pedido) para que dos corridas del cron no devuelvan dos veces.
  const { data: colgados } = await sb
    .from('pedidos')
    .select('id,productos,cupon_codigo')
    .eq('estado_pago', 'pendiente').eq('stock_reservado', true)
    .lt('reserva_vence_en', ahora.toISOString());
  for (const p of colgados || []) {
    const { data: claim } = await sb.from('pedidos')
      .update({ estado_pago: 'rechazado', stock_reservado: false })
      .eq('id', p.id).eq('stock_reservado', true).eq('estado_pago', 'pendiente')
      .select('id');
    if (!claim || !claim.length) continue;   // otro proceso ya lo tomó
    for (const it of p.productos || []) {
      if (it.variante_id) await sb.rpc('devolver_stock_variante', { p_variante_id: it.variante_id, p_cantidad: it.cantidad || 1 });
      else await sb.rpc('devolver_stock', { p_producto_id: it.producto_id, p_cantidad: it.cantidad || 1 });
    }
    // el cupón (si había) vuelve a quedar disponible
    if (p.cupon_codigo) await sb.from('items_usuario').update({ usado_en: null }).eq('codigo', p.cupon_codigo);
    checkoutsLiberados++;
  }

  // Vencer reservas expiradas y devolver stock.
  const { data: expiradas, error: e1 } = await sb
    .from('reservas').select('id,producto_id')
    .eq('estado', 'activa').lt('expira_en', ahora.toISOString());
  if (e1) throw e1;
  for (const r of expiradas || []) {
    await sb.from('reservas').update({ estado: 'vencida' }).eq('id', r.id);
    const { data: prod } = await sb.from('productos')
      .select('stock_disponible,stock_reservado').eq('id', r.producto_id).maybeSingle();
    if (prod) {
      await sb.from('productos').update({
        stock_disponible: prod.stock_disponible + 1,
        stock_reservado: Math.max(prod.stock_reservado - 1, 0),
      }).eq('id', r.producto_id);
    }
    vencidas++;
  }

  // Recordatorios 10h / 20h.
  const { data: activas } = await sb
    .from('reservas')
    .select('id,cliente_contacto,creado_en,recordatorio_10h,recordatorio_20h,producto_id')
    .eq('estado', 'activa');
  const ig = process.env.INSTAGRAM_DM || '#';
  for (const r of activas || []) {
    const horas = (ahora - new Date(r.creado_en)) / 3600000;
    let actualizar = null;
    if (horas >= 20 && !r.recordatorio_20h) actualizar = { recordatorio_20h: true };
    else if (horas >= 10 && !r.recordatorio_10h) actualizar = { recordatorio_10h: true };
    if (!actualizar) continue;
    const { data: prod } = await sb.from('productos').select('nombre').eq('id', r.producto_id).maybeSingle();
    const ultimo = !!actualizar.recordatorio_20h;
    await enviarMail({
      to: r.cliente_contacto,
      subject: ultimo ? 'Última hora para tu reserva' : 'Recordatorio de tu reserva',
      html: plantilla({
        titulo: ultimo ? 'Tu reserva está por vencer' : 'Te queda tiempo',
        cuerpoHtml: `Tu reserva de <b>${prod?.nombre || 'tu producto'}</b> sigue activa.
          ${ultimo ? 'Vence en pocas horas.' : 'Tenés tiempo hasta completar las 24hs.'}
          Escribinos por Instagram para concretar.`,
        cta: { texto: 'Escribir por Instagram', url: ig },
      }),
    });
    await sb.from('reservas').update(actualizar).eq('id', r.id);
    recordatorios++;
  }
  json(res, 200, { ok: true, vencidas, recordatorios, checkoutsLiberados });
}

// ── resenas ───────────────────────────────────────────────────
async function cronResenas(res) {
  const sb = supa();
  const ahora = new Date();
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  let pedidas = 0, recordadas = 0;

  const { data: pedidos, error } = await sb
    .from('pedidos')
    .select('id,codigo_publico,cliente_nombre,cliente_contacto,enviado_at,resena_pedida_at')
    .eq('estado_envio', 'enviado').not('enviado_at', 'is', null);
  if (error) throw error;

  for (const p of pedidos || []) {
    if (!p.cliente_contacto) continue;
    const { count } = await sb.from('resenas')
      .select('id', { count: 'exact', head: true }).eq('pedido_id', p.id);
    if (count && count > 0) continue;

    const diasEnviado = (ahora - new Date(p.enviado_at)) / 86400000;
    const link = `${site}/resena?p=${p.codigo_publico}&t=${firmaCorta(p.codigo_publico)}`;

    if (diasEnviado >= 2 && !p.resena_pedida_at) {
      await enviarMail({
        to: p.cliente_contacto,
        subject: '¿Cómo te fue con tu compra?',
        html: plantilla({
          titulo: 'Dejanos tu reseña',
          cuerpoHtml: `Hola${p.cliente_nombre ? ' ' + p.cliente_nombre : ''}, ¿ya recibiste tu pedido
            <b>${p.codigo_publico}</b>? Contanos cómo te fue, nos re ayuda.`,
          cta: { texto: 'Dejar reseña', url: link },
        }),
      });
      await sb.from('pedidos').update({ resena_pedida_at: ahora.toISOString() }).eq('id', p.id);
      pedidas++;
      continue;
    }
    if (diasEnviado >= 4 && p.resena_pedida_at) {
      const diasDesdePedido = (ahora - new Date(p.resena_pedida_at)) / 86400000;
      if (diasDesdePedido >= 2) {
        await enviarMail({
          to: p.cliente_contacto,
          subject: 'Última: contanos cómo te fue',
          html: plantilla({
            titulo: 'Tu opinión cuenta',
            cuerpoHtml: `Te dejamos el link una vez más para reseñar tu pedido <b>${p.codigo_publico}</b>.`,
            cta: { texto: 'Dejar reseña', url: link },
          }),
        });
        await sb.from('pedidos').update({ resena_pedida_at: ahora.toISOString() }).eq('id', p.id);
        recordadas++;
      }
    }
  }
  json(res, 200, { ok: true, pedidas, recordadas });
}
