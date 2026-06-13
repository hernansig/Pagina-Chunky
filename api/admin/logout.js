import { json, methodNotAllowed } from '../../lib/http.js';
import { cookieSesion } from '../../lib/auth.js';

// POST /api/admin/logout
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'POST')) return;
  res.setHeader('Set-Cookie', cookieSesion('', { borrar: true }));
  json(res, 200, { ok: true });
}
