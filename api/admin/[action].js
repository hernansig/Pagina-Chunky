import crypto from 'node:crypto';
import { supa } from '../../lib/supabase.js';
import { json, fail, readBody } from '../../lib/http.js';
import { requireAdmin, firmarSesion, cookieSesion } from '../../lib/auth.js';

// Función única para todo /api/admin/* (login, logout, session, pedidos,
// productos, encargos, resenas). Vercel cuenta esto como 1 sola función.
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.pathname.split('/').pop();
  try {
    switch (action) {
      case 'login':     return await login(req, res);
      case 'logout':    return logout(req, res);
      case 'session':   return session(req, res);
      case 'pedidos':   return await pedidos(req, res);
      case 'productos': return await productos(req, res);
      case 'encargos':  return await encargos(req, res);
      case 'resenas':   return await resenas(req, res);
      default:          return fail(res, 404, 'Acción desconocida.');
    }
  } catch (err) {
    console.error('[admin]', action, err.message);
    fail(res, 500, 'Error en el panel.');
  }
}

function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── login / logout / session ──────────────────────────────────
async function login(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  const { user, password } = await readBody(req);
  const okUser = igual(user || '', process.env.ADMIN_USER || '');
  const okPass = igual(password || '', process.env.ADMIN_PASSWORD || '');
  if (!okUser || !okPass) return fail(res, 401, 'Usuario o contraseña incorrectos.');
  res.setHeader('Set-Cookie', cookieSesion(firmarSesion({})));
  json(res, 200, { ok: true });
}

function logout(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  res.setHeader('Set-Cookie', cookieSesion('', { borrar: true }));
  json(res, 200, { ok: true });
}

function session(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido.');
  if (requireAdmin(req, res)) return;
  json(res, 200, { ok: true });
}

// ── pedidos ───────────────────────────────────────────────────
async function pedidos(req, res) {
  if (requireAdmin(req, res)) return;
  const sb = supa();
  if (req.method === 'GET') {
    const { data, error } = await sb.from('pedidos').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return json(res, 200, { ok: true, pedidos: data || [] });
  }
  if (req.method === 'PATCH') {
    const { id, estado_envio } = await readBody(req);
    const validos = ['preparando', 'enviado', 'entregado'];
    if (!id || !validos.includes(estado_envio)) return fail(res, 400, 'Datos inválidos.');
    const update = { estado_envio };
    if (estado_envio === 'enviado') update.enviado_at = new Date().toISOString();
    const { error } = await sb.from('pedidos').update(update).eq('id', id);
    if (error) throw error;
    return json(res, 200, { ok: true });
  }
  fail(res, 405, 'Método no permitido.');
}

// ── productos ─────────────────────────────────────────────────
async function productos(req, res) {
  if (requireAdmin(req, res)) return;
  const sb = supa();
  if (req.method === 'GET') {
    const { data, error } = await sb.from('productos').select('*')
      .order('orden', { ascending: true }).order('created_at', { ascending: true });
    if (error) throw error;
    return json(res, 200, { ok: true, productos: data || [] });
  }
  const body = await readBody(req);
  if (req.method === 'POST') {
    if (!body.nombre || body.precio == null) return fail(res, 400, 'Nombre y precio son obligatorios.');
    const stockTotal = parseInt(body.stock_total, 10);
    const total = Number.isFinite(stockTotal) ? stockTotal : 1;
    const fila = {
      nombre: String(body.nombre).trim(),
      precio: Number(body.precio),
      foto_url: body.foto_url || null,
      talle: body.talle || null,
      stock_total: total,
      stock_disponible: total,
      stock_reservado: 0,
      activo: body.activo !== false,
      orden: parseInt(body.orden, 10) || 0,
    };
    const { data, error } = await sb.from('productos').insert(fila).select('id').single();
    if (error) throw error;
    return json(res, 200, { ok: true, id: data.id });
  }
  if (req.method === 'PATCH') {
    if (!body.id) return fail(res, 400, 'Falta el id.');
    const permitidos = ['nombre', 'precio', 'foto_url', 'talle', 'stock_total', 'stock_disponible', 'stock_reservado', 'activo', 'orden'];
    const update = {};
    for (const k of permitidos) if (k in body) update[k] = body[k];
    if (!Object.keys(update).length) return fail(res, 400, 'Nada para actualizar.');
    const { error } = await sb.from('productos').update(update).eq('id', body.id);
    if (error) throw error;
    return json(res, 200, { ok: true });
  }
  if (req.method === 'DELETE') {
    if (!body.id) return fail(res, 400, 'Falta el id.');
    const { error } = await sb.from('productos').delete().eq('id', body.id);
    if (error) throw error;
    return json(res, 200, { ok: true });
  }
  fail(res, 405, 'Método no permitido.');
}

// ── encargos ──────────────────────────────────────────────────
async function encargos(req, res) {
  if (requireAdmin(req, res)) return;
  const sb = supa();
  if (req.method === 'GET') {
    const { data, error } = await sb.from('encargos').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return json(res, 200, { ok: true, encargos: data || [] });
  }
  if (req.method === 'PATCH') {
    const { id, estado } = await readBody(req);
    const validos = ['pendiente', 'cotizado', 'confirmado'];
    if (!id || !validos.includes(estado)) return fail(res, 400, 'Datos inválidos.');
    const { error } = await sb.from('encargos').update({ estado }).eq('id', id);
    if (error) throw error;
    return json(res, 200, { ok: true });
  }
  fail(res, 405, 'Método no permitido.');
}

// ── resenas ───────────────────────────────────────────────────
async function resenas(req, res) {
  if (requireAdmin(req, res)) return;
  const sb = supa();
  if (req.method === 'GET') {
    const { data, error } = await sb.from('resenas').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return json(res, 200, { ok: true, resenas: data || [] });
  }
  if (req.method === 'PATCH') {
    const { id, estado } = await readBody(req);
    const validos = ['pendiente', 'aprobada', 'rechazada'];
    if (!id || !validos.includes(estado)) return fail(res, 400, 'Datos inválidos.');
    const { error } = await sb.from('resenas').update({ estado }).eq('id', id);
    if (error) throw error;
    return json(res, 200, { ok: true });
  }
  fail(res, 405, 'Método no permitido.');
}
