import crypto from 'node:crypto';
import { supa } from '../../lib/supabase.js';
import { json, fail, readBody } from '../../lib/http.js';
import { usuarioDeReq, getAuthUser } from '../../lib/usuario.js';
import { avisarDueno, plantilla } from '../../lib/mail.js';
import { tokenAleatorio } from '../../lib/util.js';
import { permitido, ipDe } from '../../lib/ratelimit.js';
import { verificarTurnstile } from '../../lib/captcha.js';

// Función única para /api/app/* (Vercel la cuenta como 1 sola función).
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = (req.query && req.query.action) || url.pathname.split('/').pop();
  try {
    switch (action) {
      case 'config':          return config(req, res);
      case 'me':              return await me(req, res);
      case 'perfil':          return await perfil(req, res);
      case 'ranking':         return await ranking(req, res);
      case 'iniciar-partida': return await iniciarPartida(req, res);
      case 'guardar-puntaje': return await guardarPuntaje(req, res);
      case 'ruleta-girar':    return await ruletaGirar(req, res);
      case 'comprar-vida':    return await comprarVida(req, res);
      case 'mis-items':       return await misItems(req, res);
      case 'reclamar-item':   return await reclamarItem(req, res);
      default:                return fail(res, 404, 'Acción desconocida.');
    }
  } catch (err) {
    console.error('[app]', action, err.message);
    fail(res, 500, 'Error del servidor.');
  }
}

const RULETA_COSTO = Number(process.env.RULETA_COSTO) || 1700;
const VIDA_COSTO = 200;
const LIMITE_GIROS = 20;     // giros pagos por semana
const MAX_ITEMS = 5;         // items disponibles simultáneos

// Anti-cheat del minijuego: cotas físicas de lo que se puede lograr por
// segundo REAL de partida (velocidad tope × metros/z × boost, con margen).
// La cota nunca rechaza a un jugador legítimo (el reloj de pared siempre es
// ≥ el tiempo de juego), pero vuelve inservible postear puntajes inventados.
const MAX_METROS_POR_SEG = 75;    // físico ~68.4 m/s; margen incluido
const MAX_MONEDAS_POR_SEG = 20;   // pico de recolección con margen
const MARGEN_METROS = 500;        // colchón fijo (latencia/redondeo)
const MARGEN_MONEDAS = 60;

// ── Config pública para el frontend ─────────────────────────────
function config(req, res) {
  json(res, 200, {
    ok: true,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',   // '' = captcha apagado
  });
}

// ── Usuario actual (saldo para el header) ───────────────────────
async function me(req, res) {
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  json(res, 200, { ok: true, usuario: publico(u) });
}

// ── Perfil completo: usuario + ranking (metros) + items + pedidos ──
async function perfil(req, res) {
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  const sb = supa();
  const desde = semanaDesde();

  const { posicion, mejor } = await posicionUsuario(sb, u.id, desde);

  const { data: items } = await sb.from('items_usuario')
    .select('id,tipo_item,estado,obtenido_en,canjeado_en')
    .eq('usuario_id', u.id).order('obtenido_en', { ascending: false }).limit(50);

  // Pedidos del usuario: por usuario_id o por email. Se hacen dos consultas
  // con filtros parametrizados (.eq) y se fusionan, en vez de interpolar el
  // email dentro de un .or() por string (evita alterar la consulta).
  const cols = 'codigo_publico,estado_pago,estado_envio,monto_total,productos';
  const [rUser, rMail] = await Promise.all([
    sb.from('pedidos').select(cols).eq('usuario_id', u.id).order('id', { ascending: false }).limit(20),
    u.email
      ? sb.from('pedidos').select(cols).eq('cliente_contacto', u.email).order('id', { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const dedup = new Map();
  for (const p of [...(rUser.data || []), ...(rMail.data || [])]) dedup.set(p.codigo_publico, p);
  const pedidos = [...dedup.values()].slice(0, 20);

  json(res, 200, {
    ok: true, usuario: publico(u),
    ranking: { posicion, mejor }, items: items || [], pedidos: pedidos || [],
  });
}

// ── Ranking semanal de METROS por partida ───────────────────────
// Top 10 global (puede repetir jugador). Si el usuario logueado no está en
// el top, se devuelve solo su mejor partida + su posición global.
async function ranking(req, res) {
  const sb = supa();
  const desde = semanaDesde();
  const { data, error } = await sb.from('puntajes_mensuales')
    .select('usuario_id,alias,metros')
    .gte('creado_en', desde.toISOString())
    .order('metros', { ascending: false }).limit(10);
  if (error) console.error('[ranking] select', error.message);   // columnas faltantes → esquema desactualizado
  const top = (data || []).map((r, i) => ({ pos: i + 1, alias: r.alias || 'jugador', metros: r.metros, usuario_id: r.usuario_id }));

  let tu = null;
  const authUser = await getAuthUser(req);
  if (authUser && !top.some((r) => r.usuario_id === authUser.id)) {
    const { posicion, mejor } = await posicionUsuario(sb, authUser.id, desde);
    if (posicion) tu = { pos: posicion, metros: mejor };
  }
  json(res, 200, { ok: true, top: top.map(({ usuario_id, ...r }) => r), tu });
}

// ── Iniciar partida: emite un token de sesión server-side (anti-cheat) ──
async function iniciarPartida(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  // Límite anti-spam de sesiones (por usuario): no debería crear cientos por hora.
  if (!(await permitido(`partida:${u.id}`, 3600, 200))) {
    return fail(res, 429, 'Demasiadas partidas seguidas. Probá en un rato.');
  }
  // Captcha opcional (Turnstile). Si no está configurado, no exige nada.
  const body = await readBody(req).catch(() => ({}));
  if (!(await verificarTurnstile(body && body.captcha, ipDe(req)))) {
    return fail(res, 403, 'Verificación anti-bot fallida. Recargá la página.');
  }
  const token = tokenAleatorio(24);
  const { error } = await supa().from('juego_sesiones').insert({ usuario_id: u.id, token });
  if (error) {
    console.error('[iniciar-partida]', error.message);   // tabla ausente → ¿corriste add-seguridad.sql?
    return fail(res, 500, 'No se pudo iniciar la partida.');
  }
  json(res, 200, { ok: true, token });
}

// ── Guardar partida: registra metros (ranking) + banca monedas ──
// Requiere el token de sesión emitido por iniciar-partida. Se valida que:
//  · la sesión sea del usuario y no esté ya cerrada (single-use, anti-replay);
//  · los metros/monedas sean físicamente posibles para el tiempo transcurrido.
async function guardarPuntaje(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');

  const body = await readBody(req);
  const token = (body.token || '').trim();
  const metros = clampInt(body.metros, 0, 1000000);
  const monedas = clampInt(body.monedas != null ? body.monedas : body.puntaje, 0, 100000);
  if (!token) return fail(res, 400, 'Falta el token de la partida. Actualizá la página.');

  const sb = supa();

  // Buscar la sesión de esta partida (debe ser del usuario y estar abierta).
  const { data: ses } = await sb.from('juego_sesiones')
    .select('id,iniciada_en,cerrada').eq('token', token).eq('usuario_id', u.id).maybeSingle();
  if (!ses) return fail(res, 403, 'Sesión de partida inválida.');

  // Cerrar la sesión de forma ATÓMICA (una sola escritura gana el race).
  // Si otra request ya la cerró → esta partida no se guarda dos veces.
  const { data: cerrada } = await sb.from('juego_sesiones')
    .update({ cerrada: true, metros, monedas })
    .eq('id', ses.id).eq('cerrada', false).select('id');
  if (!cerrada || !cerrada.length) return fail(res, 409, 'Esa partida ya fue guardada.');

  // Plausibilidad: ¿es posible ese puntaje en el tiempo real transcurrido?
  const segs = Math.max(1, (Date.now() - new Date(ses.iniciada_en).getTime()) / 1000);
  const maxMetros = segs * MAX_METROS_POR_SEG + MARGEN_METROS;
  const maxMonedas = segs * MAX_MONEDAS_POR_SEG + MARGEN_MONEDAS;
  if (metros > maxMetros || monedas > maxMonedas) {
    console.warn('[guardar-puntaje] rechazado por implausible', { usuario: u.id, segs: Math.round(segs), metros, monedas });
    return fail(res, 422, 'Puntaje inválido.');   // sesión ya cerrada: no se puede reintentar
  }

  const { error: insErr } = await sb.from('puntajes_mensuales')
    .insert({ usuario_id: u.id, alias: u.alias, metros, puntaje: monedas });
  if (insErr) {
    console.error('[guardar-puntaje] insert', insErr.message);   // p.ej. NOT NULL de jugador_id/mes (esquema viejo)
    return fail(res, 500, 'No se pudo guardar el puntaje.');
  }
  await prunearPartidas(sb, u.id);   // dejar solo las 10 mejores de la semana

  let saldo = u.puntos_disponibles;
  if (monedas > 0) {
    const { data } = await sb.rpc('sumar_puntos', { p_usuario_id: u.id, p_delta: monedas });
    saldo = data ?? (u.puntos_disponibles + monedas);
  }
  json(res, 200, { ok: true, metros, monedas, puntos_disponibles: saldo });
}

// Conserva solo las 10 mejores partidas (por metros) del usuario en la semana.
async function prunearPartidas(sb, usuarioId) {
  const desde = semanaDesde();
  const { data: rows } = await sb.from('puntajes_mensuales')
    .select('id,metros').eq('usuario_id', usuarioId)
    .gte('creado_en', desde.toISOString()).order('metros', { ascending: false });
  if (rows && rows.length > 10) {
    const sobran = rows.slice(10).map((r) => r.id);
    await sb.from('puntajes_mensuales').delete().in('id', sobran);
  }
}

// ── Comprar 1 corazón (200 monedas, descuenta del saldo guardado) ──
async function comprarVida(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  const sb = supa();
  const { data: ok } = await sb.rpc('gastar_puntos', { p_usuario_id: u.id, p_costo: VIDA_COSTO });
  if (!ok) return fail(res, 409, `Necesitás ${VIDA_COSTO} monedas para comprar un corazón.`);
  const { data: cur } = await sb.from('usuarios').select('puntos_disponibles').eq('id', u.id).maybeSingle();
  json(res, 200, { ok: true, costo: VIDA_COSTO, puntos_disponibles: cur?.puntos_disponibles ?? 0 });
}

// ── Mis items (canjeables) ──────────────────────────────────────
async function misItems(req, res) {
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  const { data } = await supa().from('items_usuario')
    .select('id,tipo_item,estado,obtenido_en,canjeado_en')
    .eq('usuario_id', u.id).order('obtenido_en', { ascending: false }).limit(60);
  json(res, 200, { ok: true, items: data || [] });
}

async function reclamarItem(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  const { id } = await readBody(req);
  if (!id) return fail(res, 400, 'Falta el item.');
  const sb = supa();
  const { data: it } = await sb.from('items_usuario')
    .select('id,estado,tipo_item').eq('id', id).eq('usuario_id', u.id).maybeSingle();
  if (!it) return fail(res, 404, 'Item no encontrado.');
  if (it.estado === 'canjeado') return fail(res, 409, 'Ese premio ya fue reclamado.');
  await sb.from('items_usuario').update({ estado: 'canjeado', canjeado_en: new Date().toISOString() }).eq('id', id);
  avisarReclamo(u, it.tipo_item).catch((e) => console.error('[reclamo mail]', e.message));
  json(res, 200, { ok: true });
}

// ── Ruleta — 100% server-side (crypto), límites y items ─────────
const WHEEL = ['nada', 'otro_giro', 'llavero_chunky', 'nada', 'otro_giro', 'envio_gratis', 'nada', 'llavero_chunky', 'otro_giro', 'chunky_bag'];
const PESOS = { nada: 35, otro_giro: 30, llavero_chunky: 18, envio_gratis: 12, chunky_bag: 5 };
const ITEM_TIPOS = ['envio_gratis', 'chunky_bag', 'llavero_chunky'];
const ETIQUETAS = {
  nada: '¡Casi! Seguí girando',
  otro_giro: '¡Otro giro gratis!',
  llavero_chunky: '¡Ganaste un Llavero Chunky!',
  envio_gratis: '¡Envío gratis en tu próximo pedido!',
  chunky_bag: '¡Ganaste una Chunky Bag!',
};
const NOMBRE_ITEM = { envio_gratis: 'ENVÍO GRATIS en su próximo pedido', chunky_bag: 'una CHUNKY BAG', llavero_chunky: 'un LLAVERO CHUNKY' };

async function ruletaGirar(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido.');
  const u = await usuarioDeReq(req);
  if (!u) return fail(res, 401, 'No autenticado.');
  const sb = supa();

  // Límite de items guardados (máx 5 disponibles).
  const { count: itemsDisp } = await sb.from('items_usuario')
    .select('id', { count: 'exact', head: true }).eq('usuario_id', u.id).eq('estado', 'disponible');
  if ((itemsDisp || 0) >= MAX_ITEMS) {
    return fail(res, 409, `Ya tenés el máximo de premios guardados (${MAX_ITEMS}). Canjeá alguno antes de seguir girando.`);
  }

  const ref = semanaRef();

  // Cobro ATÓMICO del giro (giro gratis o pago) con lock de la fila del
  // usuario. Elimina el race de leer-saldo → modificar → escribir: disparar
  // N giros en paralelo ya no permite saltarse el límite ni el saldo.
  const { data: cobroRows, error: cobroErr } = await sb.rpc('cobrar_giro_ruleta', {
    p_usuario_id: u.id, p_costo: RULETA_COSTO, p_limite: LIMITE_GIROS, p_ref: ref,
  });
  if (cobroErr) { console.error('[ruleta] cobro', cobroErr.message); return fail(res, 500, 'No se pudo girar.'); }
  const cobro = Array.isArray(cobroRows) ? cobroRows[0] : cobroRows;
  if (!cobro || !cobro.ok) {
    if (cobro && cobro.motivo === 'limite') return fail(res, 409, `Llegaste a los ${LIMITE_GIROS} giros de esta semana. Vuelven a empezar el lunes.`);
    if (cobro && cobro.motivo === 'saldo') return fail(res, 409, `Necesitás ${RULETA_COSTO} monedas para girar.`);
    return fail(res, 409, 'No se pudo girar.');
  }
  let pts = cobro.puntos;
  let giros = cobro.giros_gratis;
  const semCount = cobro.giros_semana;

  // Sorteo con crypto (nunca Math.random) + sección de la rueda que coincida.
  const resultado = sortearPonderado(PESOS);
  const indices = WHEEL.map((t, i) => (t === resultado ? i : -1)).filter((i) => i >= 0);
  const seccion = indices[crypto.randomInt(indices.length)];

  // Recompensas (el cobro ya quedó firme; acá solo se acredita lo ganado).
  let premio = null;
  if (resultado === 'otro_giro') {
    const { data: g } = await sb.rpc('sumar_giros_gratis', { p_usuario_id: u.id, p_delta: 1 });
    giros = g != null ? g : giros + 1;
    premio = 'otro_giro';
  } else if (ITEM_TIPOS.includes(resultado)) {
    await sb.from('items_usuario').insert({ usuario_id: u.id, tipo_item: resultado });
    premio = resultado;
    avisarPremio(u, resultado).catch((e) => console.error('[ruleta mail]', e.message));
  }

  json(res, 200, {
    ok: true, resultado, seccion, etiqueta: ETIQUETAS[resultado], premio,
    puntos_disponibles: pts, giros_gratis: giros,
    giros_restantes: Math.max(0, LIMITE_GIROS - semCount),
    items_disponibles: (itemsDisp || 0) + (ITEM_TIPOS.includes(resultado) ? 1 : 0),
  });
}

async function avisarPremio(u, tipo) {
  await avisarDueno({
    subject: `RULETA — premio: ${tipo}`,
    html: plantilla({
      titulo: 'Premio de la ruleta',
      cuerpoHtml: `<b>${u.nombre || u.alias || 'Un usuario'}</b> (${u.email}) ganó <b>${NOMBRE_ITEM[tipo] || tipo}</b> en la ruleta.<br><br>
        Queda guardado como item disponible. Cuando lo reclame desde su perfil, coordinás la entrega por Instagram.`,
    }),
  });
}
async function avisarReclamo(u, tipo) {
  const fecha = new Intl.DateTimeFormat('es-UY', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Montevideo',
  }).format(new Date());
  await avisarDueno({
    subject: `RECLAMO de premio: ${tipo}`,
    html: plantilla({
      titulo: 'Reclamo de premio',
      cuerpoHtml: `<b>${u.nombre || u.alias || 'Un usuario'}</b> (${u.email}) reclamó <b>${NOMBRE_ITEM[tipo] || tipo}</b>.<br>
        <b>Fecha del canje:</b> ${fecha} (hora Uruguay)<br><br>
        Coordiná la entrega por Instagram (@chunkysnkrs.uy).`,
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
function semanaDesde() {
  // Lunes 00:00 de Uruguay (UTC-3 fijo, sin horario de verano), devuelto en UTC.
  // El servidor (Vercel) corre en UTC; sin esto la semana reiniciaría 3 h antes.
  const OFFSET_MS = 3 * 60 * 60 * 1000;
  const mvd = new Date(Date.now() - OFFSET_MS);           // "ahora" como reloj de pared MVD (en campos UTC)
  const dia = (mvd.getUTCDay() + 6) % 7;                  // 0 = lunes
  const lunesWall = Date.UTC(mvd.getUTCFullYear(), mvd.getUTCMonth(), mvd.getUTCDate() - dia, 0, 0, 0, 0);
  return new Date(lunesWall + OFFSET_MS);                 // ese instante, de vuelta en UTC real
}
function semanaRef() { return semanaDesde().toISOString().slice(0, 10); }

// Mejor partida (metros) del usuario en la semana + su posición global.
async function posicionUsuario(sb, usuarioId, desde) {
  const { data: mb } = await sb.from('puntajes_mensuales')
    .select('metros').eq('usuario_id', usuarioId).gte('creado_en', desde.toISOString())
    .order('metros', { ascending: false }).limit(1).maybeSingle();
  if (!mb) return { posicion: null, mejor: 0 };
  const { count } = await sb.from('puntajes_mensuales')
    .select('id', { count: 'exact', head: true })
    .gte('creado_en', desde.toISOString()).gt('metros', mb.metros);
  return { posicion: (count || 0) + 1, mejor: mb.metros };
}
function sortearPonderado(pesos) {
  const total = Object.values(pesos).reduce((a, b) => a + b, 0);
  let r = crypto.randomInt(total);   // 0..total-1, sin Math.random
  for (const [k, w] of Object.entries(pesos)) { if (r < w) return k; r -= w; }
  return 'nada';
}
