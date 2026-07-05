import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody } from '../lib/http.js';
import { avisarDueno, plantilla } from '../lib/mail.js';
import { permitido, ipDe } from '../lib/ratelimit.js';
import { escHtml } from '../lib/util.js';

// POST /api/encargo — body: { nombre, contacto, producto_deseado, talle?, detalles? }
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'POST')) return;
  try {
    // Anti-flood: máx 5 encargos por IP cada 10 min (cada uno manda un mail).
    if (!(await permitido(`encargo:${ipDe(req)}`, 600, 5))) {
      return fail(res, 429, 'Muchos envíos seguidos. Esperá unos minutos.');
    }

    const body = await readBody(req);
    const nombre = (body.nombre || '').trim();
    const contacto = (body.contacto || '').trim();
    const producto = (body.producto_deseado || '').trim();
    const talle = (body.talle || '').trim() || null;
    const detalles = (body.detalles || '').trim() || null;

    if (nombre.length < 2) return fail(res, 400, 'Nombre inválido.');
    if (contacto.length < 5) return fail(res, 400, 'Contacto inválido.');
    if (producto.length < 2) return fail(res, 400, 'Indicá qué producto buscás.');

    const sb = supa();
    const { error } = await sb.from('encargos').insert({
      cliente_nombre: nombre,
      contacto,
      producto_deseado: producto,
      talle,
      detalles,
      estado: 'pendiente',
    });
    if (error) throw error;

    await avisarDueno({
      subject: `Nuevo encargo — ${producto}`,
      html: plantilla({
        titulo: 'Nuevo encargo',
        cuerpoHtml: `
          <b>Cliente:</b> ${escHtml(nombre)}<br>
          <b>Contacto:</b> ${escHtml(contacto)}<br>
          <b>Producto:</b> ${escHtml(producto)}<br>
          <b>Talle:</b> ${escHtml(talle) || '—'}<br>
          <b>Detalles:</b> ${escHtml(detalles) || '—'}`,
      }),
    });

    json(res, 200, { ok: true });
  } catch (err) {
    console.error('[encargo]', err.message);
    fail(res, 500, 'No se pudo enviar el encargo.');
  }
}
