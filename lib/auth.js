import crypto from 'node:crypto';
import { fail } from './http.js';

const COOKIE = 'chk_admin';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error('Falta ADMIN_SESSION_SECRET en el entorno.');
  return s;
}

// Crea un token firmado (HMAC-SHA256) con vencimiento.
export function firmarSesion({ ttlSegundos = 60 * 60 * 12 } = {}) {
  const payload = { sub: 'admin', exp: Math.floor(Date.now() / 1000) + ttlSegundos };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verificarSesion(token) {
  if (!token || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  const esperado = b64url(crypto.createHmac('sha256', secret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(fromB64url(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

export function cookieSesion(token, { borrar = false } = {}) {
  const maxAge = borrar ? 0 : 60 * 60 * 12;
  return `${COOKIE}=${borrar ? '' : token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function leerCookie(req, nombre) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Guard para endpoints /api/admin/*. Devuelve true si NO está autorizado
// (y ya respondió 401). Uso: if (requireAdmin(req, res)) return;
export function requireAdmin(req, res) {
  const token = leerCookie(req, COOKIE);
  if (!verificarSesion(token)) {
    fail(res, 401, 'No autorizado.');
    return true;
  }
  return false;
}

// Guard para endpoints /api/cron/*. Acepta el header Authorization de
// Vercel Cron (Bearer CRON_SECRET) o ?secret= para pingers externos.
export function requireCron(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) { fail(res, 500, 'CRON_SECRET no configurado.'); return true; }
  const auth = req.headers.authorization || '';
  const url = new URL(req.url, 'http://x');
  const qs = url.searchParams.get('secret');
  const ok = auth === `Bearer ${expected}` || qs === expected;
  if (!ok) { fail(res, 401, 'No autorizado.'); return true; }
  return false;
}
