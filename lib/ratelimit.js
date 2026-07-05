import { supa } from './supabase.js';

// Rate limiting distribuido sobre Postgres (función rate_touch en add-seguridad.sql).
// permitido(clave, ventanaSeg, maxHits) → true si sigue dentro del límite.
//
// Diseño "fail-open": si el limitador falla (tabla ausente, error de red),
// devuelve true para NO tirar abajo el sitio por un problema de infra. El
// objetivo es frenar bots/floods, no ser una barrera de seguridad dura.
export async function permitido(clave, ventanaSeg, maxHits) {
  try {
    const { data, error } = await supa().rpc('rate_touch', {
      p_clave: clave, p_ventana_seg: ventanaSeg, p_max: maxHits,
    });
    if (error) { console.warn('[ratelimit]', error.message); return true; }
    return data === true;
  } catch (e) {
    console.warn('[ratelimit]', e.message);
    return true;
  }
}

// IP del cliente detrás del proxy de Vercel (primer valor de x-forwarded-for).
export function ipDe(req) {
  const xff = req.headers['x-forwarded-for'] || '';
  const primera = String(xff).split(',')[0].trim();
  return primera || (req.socket && req.socket.remoteAddress) || 'desconocida';
}
