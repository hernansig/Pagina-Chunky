import { supa } from '../../lib/supabase.js';
import { json, fail } from '../../lib/http.js';
import { requireCron } from '../../lib/auth.js';
import { enviarMail, plantilla } from '../../lib/mail.js';
import { firmaCorta } from '../../lib/util.js';

// GET /api/cron/resenas — corre 1 vez por día.
// Pide reseña a los pedidos enviados hace 2 días; recordatorio a los 4 días.
export default async function handler(req, res) {
  if (requireCron(req, res)) return;
  try {
    const sb = supa();
    const ahora = new Date();
    const site = (process.env.SITE_URL || '').replace(/\/$/, '');
    let pedidas = 0;
    let recordadas = 0;

    // Pedidos enviados sin reseña todavía.
    const { data: pedidos, error } = await sb
      .from('pedidos')
      .select('id,codigo_publico,cliente_nombre,cliente_contacto,enviado_at,resena_pedida_at')
      .eq('estado_envio', 'enviado')
      .not('enviado_at', 'is', null);
    if (error) throw error;

    for (const p of pedidos || []) {
      if (!p.cliente_contacto) continue;

      // ¿Ya dejó reseña?
      const { count } = await sb
        .from('resenas')
        .select('id', { count: 'exact', head: true })
        .eq('pedido_id', p.id);
      if (count && count > 0) continue;

      const diasEnviado = (ahora - new Date(p.enviado_at)) / 86400000;
      const link = `${site}/resena?p=${p.codigo_publico}&t=${firmaCorta(p.codigo_publico)}`;

      // Primera solicitud: >= 2 días y nunca pedida.
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

      // Recordatorio: >= 4 días, ya pedida hace >= 2 días.
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
  } catch (err) {
    console.error('[cron/resenas]', err.message);
    fail(res, 500, 'error en cron');
  }
}
