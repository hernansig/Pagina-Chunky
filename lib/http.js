// Helpers HTTP comunes para las Vercel Functions.

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function fail(res, status, mensaje) {
  json(res, status, { ok: false, error: mensaje });
}

// Devuelve true si el método NO está permitido (y ya respondió 405).
export function methodNotAllowed(req, res, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (!list.includes(req.method)) {
    res.setHeader('Allow', list.join(', '));
    fail(res, 405, `Método ${req.method} no permitido.`);
    return true;
  }
  return false;
}

// En Vercel, req.body ya viene parseado si el content-type es JSON.
// Esta función cubre los casos en que llega como string o vacío.
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  // Fallback: leer el stream manualmente.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

export function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}
