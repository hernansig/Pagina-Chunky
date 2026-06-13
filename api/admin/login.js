import crypto from 'node:crypto';
import { json, fail, methodNotAllowed, readBody } from '../../lib/http.js';
import { firmarSesion, cookieSesion } from '../../lib/auth.js';

function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// POST /api/admin/login — body: { user, password }
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'POST')) return;
  try {
    const { user, password } = await readBody(req);
    const okUser = igual(user || '', process.env.ADMIN_USER || '');
    const okPass = igual(password || '', process.env.ADMIN_PASSWORD || '');
    if (!okUser || !okPass) return fail(res, 401, 'Usuario o contraseña incorrectos.');

    const token = firmarSesion({});
    res.setHeader('Set-Cookie', cookieSesion(token));
    json(res, 200, { ok: true });
  } catch (err) {
    console.error('[admin/login]', err.message);
    fail(res, 500, 'Error al iniciar sesión.');
  }
}
