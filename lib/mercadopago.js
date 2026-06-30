import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import crypto from 'node:crypto';

let _config = null;
function config() {
  if (_config) return _config;
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('Falta MP_ACCESS_TOKEN en el entorno.');
  _config = new MercadoPagoConfig({ accessToken });
  return _config;
}

// Crea una preferencia de Checkout Pro y devuelve { id, init_point }.
export async function crearPreferencia({ items, codigoPedido, payerEmail }) {
  const pref = new Preference(config());
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const result = await pref.create({
    body: {
      items: items.map((it) => ({
        id: String(it.id),
        title: it.nombre,
        quantity: it.cantidad || 1,
        unit_price: Number(it.precio),
        currency_id: process.env.CURRENCY || 'UYU',
      })),
      payer: payerEmail ? { email: payerEmail } : undefined,
      external_reference: codigoPedido,
      back_urls: {
        success: `${site}/pedido-confirmado?codigo=${codigoPedido}`,
        pending: `${site}/?pago=pendiente`,
        failure: `${site}/?pago=cancelado`,
      },
      auto_return: 'approved',
      notification_url: `${site}/api/webhook`,
      statement_descriptor: 'CHUNKYSNKRS',
    },
  });
  return { id: result.id, init_point: result.init_point };
}

// Consulta un pago por id (fuente de verdad del estado).
export async function obtenerPago(paymentId) {
  const payment = new Payment(config());
  return payment.get({ id: paymentId });
}

// ── Validación de la firma del webhook (x-signature) ──────────────────
// MP firma un "manifest" con HMAC-SHA256 usando el secreto del webhook.
// Formato del header x-signature: "ts=<timestamp>,v1=<hash>"
// Manifest: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
export function validarFirmaWebhook({ xSignature, xRequestId, dataId }) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return { ok: false, motivo: 'MP_WEBHOOK_SECRET no configurado' };
  if (!xSignature) return { ok: false, motivo: 'falta x-signature' };

  const parts = Object.fromEntries(
    xSignature.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k.trim(), v.join('=').trim()];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return { ok: false, motivo: 'x-signature malformado' };

  // data.id va en minúscula y como string.
  const id = dataId != null ? String(dataId).toLowerCase() : '';
  let manifest = `id:${id};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  // Comparación en tiempo constante.
  const a = Buffer.from(hmac);
  const b = Buffer.from(v1);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, motivo: ok ? null : 'firma inválida' };
}
