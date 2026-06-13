import { supa } from '../../lib/supabase.js';
import { json, fail } from '../../lib/http.js';
import { requireCron } from '../../lib/auth.js';
import { enviarMail, plantilla } from '../../lib/mail.js';

// GET /api/cron/liberar-reservas — corre cada hora.
// 1) Vence reservas pasadas de 24hs y devuelve el stock.
// 2) Manda recordatorios a las ~10h y ~20h de creada la reserva.
export default async function handler(req, res) {
  if (requireCron(req, res)) return;
  try {
    const sb = supa();
    const ahora = new Date();
    let vencidas = 0;
    let recordatorios = 0;

    // ── 1) Vencer reservas expiradas ──
    const { data: expiradas, error: e1 } = await sb
      .from('reservas')
      .select('id,producto_id')
      .eq('estado', 'activa')
      .lt('expira_en', ahora.toISOString());
    if (e1) throw e1;

    for (const r of expiradas || []) {
      await sb.from('reservas').update({ estado: 'vencida' }).eq('id', r.id);
      // Devolver el stock.
      const { data: prod } = await sb
        .from('productos')
        .select('stock_disponible,stock_reservado')
        .eq('id', r.producto_id)
        .maybeSingle();
      if (prod) {
        await sb.from('productos').update({
          stock_disponible: prod.stock_disponible + 1,
          stock_reservado: Math.max(prod.stock_reservado - 1, 0),
        }).eq('id', r.producto_id);
      }
      vencidas++;
    }

    // ── 2) Recordatorios ──
    const { data: activas } = await sb
      .from('reservas')
      .select('id,cliente_contacto,creado_en,recordatorio_10h,recordatorio_20h,producto_id')
      .eq('estado', 'activa');

    const ig = process.env.INSTAGRAM_DM || '#';
    for (const r of activas || []) {
      const horas = (ahora - new Date(r.creado_en)) / 3600000;
      let actualizar = null;
      if (horas >= 20 && !r.recordatorio_20h) {
        actualizar = { recordatorio_20h: true };
      } else if (horas >= 10 && !r.recordatorio_10h) {
        actualizar = { recordatorio_10h: true };
      }
      if (!actualizar) continue;

      const { data: prod } = await sb.from('productos').select('nombre').eq('id', r.producto_id).maybeSingle();
      const ultimo = actualizar.recordatorio_20h;
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

    json(res, 200, { ok: true, vencidas, recordatorios });
  } catch (err) {
    console.error('[cron/liberar-reservas]', err.message);
    fail(res, 500, 'error en cron');
  }
}
