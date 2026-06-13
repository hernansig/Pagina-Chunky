import { json, methodNotAllowed } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';

// GET /api/admin/session — 200 si hay sesión válida, 401 si no.
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'GET')) return;
  if (requireAdmin(req, res)) return;
  json(res, 200, { ok: true });
}
