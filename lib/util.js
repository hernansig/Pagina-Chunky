import crypto from 'node:crypto';

// Código público de pedido legible: CHK-XXXXXX (sin caracteres ambiguos).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generarCodigoPedido() {
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return `CHK-${s}`;
}

export function tokenAleatorio(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function mesActual() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Firma corta para validar links públicos (ej. link de reseña en un mail).
export function firmaCorta(valor) {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  return crypto.createHmac('sha256', secret).update(String(valor)).digest('base64url').slice(0, 24);
}

export function verificarFirmaCorta(valor, sig) {
  if (!sig) return false;
  const esperado = firmaCorta(valor);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Escapa texto del cliente antes de meterlo en el HTML de un mail (evita
// inyección de HTML en la casilla del dueño). Devuelve '' si viene vacío.
export function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Normaliza texto de formulario para guardar en la DB: fuerza a string,
// recorta espacios y limita el largo (evita basura/DoS de almacenamiento).
// Devuelve '' si viene vacío/nulo.
export function limpiar(s, max = 200) {
  if (s == null) return '';
  return String(s).trim().slice(0, max);
}

// ¿Es un UUID válido? (para no mandar basura a columnas uuid → error 500).
export function esUUID(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
