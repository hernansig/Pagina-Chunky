import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody, isEmail } from '../lib/http.js';
import { enviarMail, avisarDueno, plantilla } from '../lib/mail.js';
import { permitido, ipDe } from '../lib/ratelimit.js';
import { escHtml } from '../lib/util.js';

const MAX_RESERVAS_EMAIL = 3;   // reservas activas simultáneas por email

// POST /api/reservar — body: { producto_id, email }
// Bloquea el producto 24hs para ese mail. Solo ese mail puede continuar.
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'POST')) return;
  try {
    // Anti-flood: máx 10 reservas por IP cada 10 min (cada una manda mails).
    if (!(await permitido(`reservar:${ipDe(req)}`, 600, 10))) {
      return fail(res, 429, 'Muchas reservas seguidas. Esperá unos minutos.');
    }

    const body = await readBody(req);
    const productoId = body.producto_id;
    const email = (body.email || '').trim().toLowerCase();
    if (!productoId) return fail(res, 400, 'Falta el producto.');
    if (!isEmail(email)) return fail(res, 400, 'Email inválido.');

    const sb = supa();

    // Cap por email: un mismo mail no puede congelar medio catálogo.
    const { count: activasEmail } = await sb.from('reservas')
      .select('id', { count: 'exact', head: true })
      .eq('cliente_contacto', email).eq('estado', 'activa')
      .gt('expira_en', new Date().toISOString());
    if ((activasEmail || 0) >= MAX_RESERVAS_EMAIL) {
      return fail(res, 409, `Ya tenés ${MAX_RESERVAS_EMAIL} reservas activas. Concretá o esperá a que venzan para reservar más.`);
    }
    const { data: producto, error: e1 } = await sb
      .from('productos')
      .select('id,nombre,talle,stock_disponible,stock_reservado,activo')
      .eq('id', productoId)
      .maybeSingle();
    if (e1) throw e1;
    if (!producto || !producto.activo) return fail(res, 404, 'Producto no disponible.');

    // ¿Ya hay una reserva activa de este producto?
    const { data: activa } = await sb
      .from('reservas')
      .select('id,cliente_contacto,expira_en')
      .eq('producto_id', productoId)
      .eq('estado', 'activa')
      .gt('expira_en', new Date().toISOString())
      .maybeSingle();

    if (activa) {
      // Mismo mail → devolver la reserva existente. Otro mail → bloqueado.
      if (activa.cliente_contacto === email) {
        return json(res, 200, {
          ok: true,
          ya_reservado: true,
          expira_en: activa.expira_en,
          instagram: process.env.INSTAGRAM_DM,
        });
      }
      return fail(res, 409, 'Este producto ya está reservado por otra persona.');
    }

    if (producto.stock_disponible < 1) return fail(res, 409, 'Sin stock disponible.');

    // Crear la reserva y mover el stock a "reservado". El índice único
    // `uniq_reserva_activa_producto` garantiza a nivel DB una sola reserva
    // activa por producto: si dos requests corren a la vez, la segunda falla
    // con violación de unicidad (23505) → la tratamos como "ya reservado".
    const { data: reserva, error: e2 } = await sb
      .from('reservas')
      .insert({ producto_id: productoId, cliente_contacto: email, estado: 'activa' })
      .select('id,expira_en')
      .single();
    if (e2) {
      if (e2.code === '23505') return fail(res, 409, 'Este producto ya está reservado por otra persona.');
      throw e2;
    }

    await sb.from('productos').update({
      stock_disponible: producto.stock_disponible - 1,
      stock_reservado: producto.stock_reservado + 1,
    }).eq('id', productoId);

    // Mail al cliente (0h) + aviso al dueño.
    const ig = process.env.INSTAGRAM_DM || '#';
    await enviarMail({
      to: email,
      subject: `Reservaste ${producto.nombre} — tenés 24hs`,
      html: plantilla({
        titulo: 'Producto reservado',
        cuerpoHtml: `
          Reservaste <b>${producto.nombre}</b>${producto.talle ? ` (T ${producto.talle})` : ''}.<br><br>
          Queda bloqueado <b>24 horas</b> para vos. Para concretar la compra escribinos
          por Instagram con este mismo mail.<br><br>
          Si pasan las 24hs sin concretar, la reserva se libera automáticamente.`,
        cta: { texto: 'Escribir por Instagram', url: ig },
      }),
    });
    await avisarDueno({
      subject: `Nueva reserva — ${producto.nombre}`,
      html: plantilla({
        titulo: 'Nueva reserva',
        cuerpoHtml: `<b>Producto:</b> ${escHtml(producto.nombre)}<br><b>Cliente:</b> ${escHtml(email)}<br>Vence: ${escHtml(reserva.expira_en)}`,
      }),
    });

    json(res, 200, { ok: true, expira_en: reserva.expira_en, instagram: ig });
  } catch (err) {
    console.error('[reservar]', err.message);
    fail(res, 500, 'No se pudo reservar.');
  }
}
