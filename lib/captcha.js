// Verificación de captcha con Cloudflare Turnstile (alternativa a reCAPTCHA,
// sin el tracking publicitario de Google → no rompe la política de cookies).
//
// OPCIONAL y apagado por defecto: si no está configurado TURNSTILE_SECRET, no
// se exige nada (el juego funciona igual que hoy). Para activarlo hacen falta:
//   · TURNSTILE_SECRET     (backend, en las env vars de Vercel)
//   · TURNSTILE_SITE_KEY   (se expone al front vía /api/app/config)
// Registrar el sitio en: https://dash.cloudflare.com/?to=/:account/turnstile
export async function verificarTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;          // no configurado → no se exige (default)
  if (!token) return false;          // configurado pero sin token → rechazar
  try {
    const form = new URLSearchParams();
    form.append('secret', secret);
    form.append('response', String(token));
    if (ip) form.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form,
    });
    const j = await r.json();
    return j && j.success === true;
  } catch (e) {
    console.warn('[turnstile]', e.message);
    return true;                      // error de red con Cloudflare → fail-open
  }
}
