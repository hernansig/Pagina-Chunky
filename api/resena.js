import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody } from '../lib/http.js';
import { verificarFirmaCorta } from '../lib/util.js';
import { permitido, ipDe } from '../lib/ratelimit.js';

// POST /api/resena — recibe la reseña desde el link del mail (sin login).
// body: { codigo, token, rating, texto, nombre? }
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'POST')) return;
  try {
    // Anti-flood: máx 20 envíos por IP cada 10 min (además de la firma del link).
    if (!(await permitido(`resena:${ipDe(req)}`, 600, 20))) {
      return fail(res, 429, 'Demasiados envíos. Esperá unos minutos.');
    }

    const body = await readBody(req);
    const codigo = (body.codigo || '').trim().toUpperCase();
    const token = (body.token || '').trim();
    const rating = parseInt(body.rating, 10);
    const texto = (body.texto || '').trim();
    const nombre = (body.nombre || '').trim() || null;

    if (!codigo || !verificarFirmaCorta(codigo, token)) return fail(res, 401, 'Link inválido.');
    if (!(rating >= 1 && rating <= 5)) return fail(res, 400, 'Puntuación inválida.');
    if (texto.length < 4 || texto.length > 600) return fail(res, 400, 'Texto inválido.');

    const sb = supa();
    const { data: pedido } = await sb
      .from('pedidos')
      .select('id,cliente_nombre')
      .eq('codigo_publico', codigo)
      .maybeSingle();
    if (!pedido) return fail(res, 404, 'Pedido no encontrado.');

    // Una reseña por pedido.
    const { count } = await sb
      .from('resenas')
      .select('id', { count: 'exact', head: true })
      .eq('pedido_id', pedido.id);
    if (count && count > 0) return fail(res, 409, 'Ya dejaste tu reseña. ¡Gracias!');

    const { error } = await sb.from('resenas').insert({
      pedido_id: pedido.id,
      cliente_nombre: nombre || pedido.cliente_nombre,
      texto,
      rating,
      estado: 'pendiente',
    });
    if (error) throw error;

    json(res, 200, { ok: true });
  } catch (err) {
    console.error('[resena]', err.message);
    fail(res, 500, 'No se pudo guardar la reseña.');
  }
}
