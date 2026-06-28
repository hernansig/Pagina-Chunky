import { supa } from '../../lib/supabase.js';
import { json, fail, readBody } from '../../lib/http.js';
import { usuarioDeReq } from '../../lib/usuario.js';
import { avisarDueno, plantilla } from '../../lib/mail.js';

// Función única para /api/app/* (config, me, perfil, ranking, guardar-puntaje,
// ruleta-girar). Vercel la cuenta como 1 sola función.
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.pathname.split('/').pop();
  try {
    switch (action) {
      case 'config':         return config(req, res);
      case 'me':             return await me(req, res);
      case 'perfil':         return await perfil(req, res);
      case 'ranking':        return await ranking(req, res);
      case 'guardar-puntaje':return await guardarPuntaje(req, res);
      case 'ruleta-girar':   return await ruletaGirar(req, res);
      default:               return fail(res, 404, 'Acción desconocida.');
    }
  } catch (err) {
    console.error('[app]', action, err.message);
    fail(res, 500, 'Error del servidor.');
  }
}

// ── Config pública para el frontend (URL + anon key) ────────────
function config(req, res) {
  json(res, 200, {
    ok: true,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
}

// ── Usuario actual (saldo para el header) ───────────────────────
async function me(req, res) {
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  json(res, 200, { ok: true, usuario: publico(u) });
}

// ── Perfil completo: usuario + ranking semanal + pedidos ────────
async function perfil(req, res) {
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  const sb = supa();

  // Posición en el ranking semanal (mejor puntaje por usuario en la semana).
  const { desde } = semanaActual();
  const { data: sem } = await sb
    .from('puntajes_mensuales')
    .select('usuario_id,puntaje')
    .gte('creado_en', desde.toISOString())
    .order('puntaje', { ascending: false })
    .limit(2000);
  const mejores = mejorPorUsuario(sem || []);
  const ranking = mejores.findIndex((r) => r.usuario_id === u.id);
  const posicion = ranking >= 0 ? ranking + 1 : null;
  const miMejor = mejores.find((r) => r.usuario_id === u.id)?.puntaje ?? 0;

  // Pedidos asociados por usuario_id o por email.
  const { data: pedidos } = await sb
    .from('pedidos')
    .select('codigo_publico,estado_pago,estado_envio,monto_total,productos')
    .or(`usuario_id.eq.${u.id},cliente_contacto.eq.${u.email}`)
    .order('id', { ascending: false })
    .limit(20);

  json(res, 200, {
    ok: true,
    usuario: publico(u),
    ranking: { posicion, mejor: miMejor, jugadores: mejores.length },
    pedidos: pedidos || [],
  });
}

// ── Ranking semanal top 10 (público, para minijuego/game over) ──
async function ranking(req, res) {
  const sb = supa();
  const { desde } = semanaActual();
  const { data } = await sb
    .from('puntajes_mensuales')
    .select('usuario_id,alias,puntaje')
    .gte('creado_en', desde.toISOString())
    .order('puntaje', { ascending: false })
    .limit(2000);
  const top = mejorPorUsuario(data || []).slice(0, 10)
    .map((r, i) => ({ pos: i + 1, alias: r.alias || 'jugador', puntaje: r.puntaje }));
  json(res, 200, { ok: true, top });
}

// ── Guardar puntaje del minijuego + sumar puntos ────────────────
async function guardarPuntaje(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');

  const body = await readBody(req);
  // Sanity caps (el score se calcula en el cliente; evitamos valores absurdos).
  const puntaje = clampInt(body.puntaje, 0, 5000);
  const metros = clampInt(body.metros, 0, 200000);

  const sb = supa();
  await sb.from('puntajes_mensuales').insert({
    usuario_id: u.id, alias: u.alias, puntaje, metros,
  });
  const { data: nuevo } = await sb.rpc('sumar_puntos', { p_usuario_id: u.id, p_delta: puntaje });

  json(res, 200, { ok: true, ganados: puntaje, puntos_disponibles: nuevo ?? (u.puntos_disponibles + puntaje) });
}

// ── Ruleta — descuento y resultado SIEMPRE server-side ──────────
const RULETA_COSTO = Number(process.env.RULETA_COSTO) || 1700;
// 10 secciones (orden de la rueda): 5 "nada", 2 "otro_giro", 2 "envio_gratis", 1 "zapas_gratis".
const WHEEL = ['nada', 'otro_giro', 'nada', 'envio_gratis', 'nada', 'otro_giro', 'nada', 'zapas_gratis', 'nada', 'envio_gratis'];
// Probabilidades ponderadas (no por cantidad de secciones). Tuneables.
const PESOS = { nada: 60, otro_giro: 22, envio_gratis: 15, zapas_gratis: 3 };

async function ruletaGirar(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  const sb = supa();

  // Cobro: usar un giro gratis si hay; si no, descontar el costo (atómico).
  let usoGiroGratis = false;
  if (u.giros_gratis > 0) {
    const { error } = await sb.from('usuarios')
      .update({ giros_gratis: u.giros_gratis - 1 }).eq('id', u.id).gt('giros_gratis', 0);
    if (error) throw error;
    usoGiroGratis = true;
  } else {
    const { data: ok } = await sb.rpc('gastar_puntos', { p_usuario_id: u.id, p_costo: RULETA_COSTO });
    if (!ok) return fail(res, 409, `Necesitás ${RULETA_COSTO} puntos para girar.`);
  }

  // Sorteo del resultado (ponderado) y elección de una sección que coincida.
  const resultado = sortearPonderado(PESOS);
  const indices = WHEEL.map((t, i) => (t === resultado ? i : -1)).filter((i) => i >= 0);
  const seccion = indices[Math.floor(Math.random() * indices.length)];

  // Efectos del premio.
  let premio = null;
  if (resultado === 'otro_giro') {
    await sb.from('usuarios').update({ giros_gratis: u.giros_gratis + (usoGiroGratis ? 0 : 1) }).eq('id', u.id);
    premio = 'otro_giro';
  } else if (resultado === 'envio_gratis' || resultado === 'zapas_gratis') {
    await sb.from('premios_ruleta').insert({ usuario_id: u.id, tipo: resultado });
    premio = resultado;
    avisarPremio(u, resultado).catch((e) => console.error('[ruleta mail]', e.message));
  }

  // Saldo final.
  const { data: actual } = await sb.from('usuarios')
    .select('puntos_disponibles,giros_gratis').eq('id', u.id).maybeSingle();

  json(res, 200, {
    ok: true,
    resultado, seccion,
    etiqueta: ETIQUETAS[resultado],
    premio,
    puntos_disponibles: actual?.puntos_disponibles ?? 0,
    giros_gratis: actual?.giros_gratis ?? 0,
  });
}

const ETIQUETAS = {
  nada: '¡Intentá de nuevo!',
  otro_giro: '¡Otro giro!',
  envio_gratis: 'Envío gratis en tu próximo pedido',
  zapas_gratis: '¡Par de zapas GRATIS!',
};

async function avisarPremio(u, tipo) {
  const texto = tipo === 'zapas_gratis' ? 'un PAR DE ZAPAS GRATIS' : 'ENVÍO GRATIS en su próximo pedido';
  await avisarDueno({
    subject: `RULETA — premio: ${tipo}`,
    html: plantilla({
      titulo: 'Premio de la ruleta',
      cuerpoHtml: `<b>${u.nombre || u.alias || 'Un usuario'}</b> (${u.email}) ganó <b>${texto}</b> en la ruleta.<br><br>
        Coordiná la entrega del premio. Queda registrado como pendiente en <b>premios_ruleta</b>.`,
    }),
  });
}

// ── Helpers ─────────────────────────────────────────────────────
function publico(u) {
  return {
    id: u.id, email: u.email, alias: u.alias, nombre: u.nombre, avatar_url: u.avatar_url,
    puntos_disponibles: u.puntos_disponibles, puntos_totales: u.puntos_totales, giros_gratis: u.giros_gratis,
  };
}
function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function semanaActual() {
  // Semana ISO (lunes 00:00 local del servidor).
  const now = new Date();
  const dia = (now.getDay() + 6) % 7; // 0 = lunes
  const desde = new Date(now);
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - dia);
  return { desde };
}
function mejorPorUsuario(rows) {
  const map = new Map();
  for (const r of rows) {
    const prev = map.get(r.usuario_id);
    if (!prev || r.puntaje > prev.puntaje) map.set(r.usuario_id, r);
  }
  return [...map.values()].sort((a, b) => b.puntaje - a.puntaje);
}
function sortearPonderado(pesos) {
  const total = Object.values(pesos).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(pesos)) { if ((r -= w) < 0) return k; }
  return 'nada';
}
