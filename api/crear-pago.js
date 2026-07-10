import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed, readBody, isEmail } from '../lib/http.js';
import { crearPreferencia } from '../lib/mercadopago.js';
import { generarCodigoPedido, limpiar, esUUID } from '../lib/util.js';
import { permitido, ipDe } from '../lib/ratelimit.js';

// POST /api/crear-pago
// body carrito:  { items: [{producto_id, variante_id?, cantidad}], nombre?, email, direccion }
// body clásico:  { producto_id, cantidad?, nombre?, email, direccion }   (compat)
// Crea un pedido "pendiente", RESERVA el stock de forma atómica (para que dos
// compras del mismo producto no se aprueben las dos) y devuelve el init_point
// de MercadoPago. El pago se sigue confirmando SOLO por webhook; si el checkout
// se abandona, el cron libera el stock reservado (reserva_vence_en).
const RESERVA_MIN = 30;   // minutos que se retiene el stock esperando el pago
const ENVIO_URUGUAY = 290;   // envío fijo a todo Uruguay (lo waivea el cupón envio_gratis)

export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'POST')) return;
  try {
    // Anti-flood: máx 15 intentos de pago por IP cada 10 min.
    if (!(await permitido(`pago:${ipDe(req)}`, 600, 15))) {
      return fail(res, 429, 'Demasiados intentos. Esperá unos minutos.');
    }

    const body = await readBody(req);
    const email = (body.email || '').trim();
    const nombre = limpiar(body.nombre, 80) || null;

    // Normalizar: carrito (items[]) o producto único (compat).
    let lineas = Array.isArray(body.items) && body.items.length
      ? body.items
      : (body.producto_id ? [{ producto_id: body.producto_id, cantidad: body.cantidad }] : []);
    lineas = lineas.slice(0, 20).map((l) => ({
      producto_id: l.producto_id,
      variante_id: l.variante_id || null,
      cantidad: Math.min(10, Math.max(1, parseInt(l.cantidad, 10) || 1)),
    }));

    if (!lineas.length || lineas.some((l) => !esUUID(l.producto_id) || (l.variante_id && !esUUID(l.variante_id)))) {
      return fail(res, 400, 'Producto inválido.');
    }
    if (!isEmail(email)) return fail(res, 400, 'Email inválido.');

    // Datos de envío (obligatorios: se manda apenas se confirma el pago).
    const d = body.direccion || {};
    const direccion = {
      calle: limpiar(d.calle, 160),
      ciudad: limpiar(d.ciudad, 100),
      departamento: limpiar(d.departamento, 100),
      cp: limpiar(d.cp, 20),
      telefono: limpiar(d.telefono, 40),
      notas: limpiar(d.notas, 300),
    };
    if (!direccion.calle || !direccion.ciudad || !direccion.departamento || !direccion.telefono) {
      return fail(res, 400, 'Completá la dirección, ciudad, departamento y teléfono.');
    }

    // Si MercadoPago no está configurado, avisamos claro (en vez de un 500 genérico).
    if (!process.env.MP_ACCESS_TOKEN) {
      return fail(res, 503, 'Los pagos no están disponibles en este momento.');
    }

    const sb = supa();
    const { data: productos, error: e1 } = await sb
      .from('productos')
      .select('id,nombre,precio,talle,stock_disponible,activo')
      .in('id', lineas.map((l) => l.producto_id));
    if (e1) throw e1;
    const porId = Object.fromEntries((productos || []).map((p) => [p.id, p]));

    // Variantes de las líneas que las usan (stock propio por variante).
    const varIds = lineas.filter((l) => l.variante_id).map((l) => l.variante_id);
    let varPorId = {};
    if (varIds.length) {
      const { data: vars, error: eV } = await sb
        .from('producto_variantes')
        .select('id,producto_id,atributo,valor,stock_disponible,activo')
        .in('id', varIds);
      if (eV) throw eV;
      varPorId = Object.fromEntries((vars || []).map((v) => [v.id, v]));
    }

    // Validar cada línea y armar los items del pedido.
    const itemsPedido = [];
    let subtotal = 0;
    for (const l of lineas) {
      const producto = porId[l.producto_id];
      if (!producto || !producto.activo) return fail(res, 404, 'Producto no disponible.');
      let variante = null;
      if (l.variante_id) {
        variante = varPorId[l.variante_id];
        if (!variante || !variante.activo || variante.producto_id !== producto.id) {
          return fail(res, 404, `La variante elegida de "${producto.nombre}" ya no está disponible.`);
        }
        if (variante.stock_disponible < l.cantidad) {
          return fail(res, 409, `Sin stock de ${producto.nombre} (${variante.valor}).`);
        }
      } else if (producto.stock_disponible < l.cantidad) {
        return fail(res, 409, `Sin stock disponible de ${producto.nombre}.`);
      }
      itemsPedido.push({
        producto_id: producto.id,
        variante_id: variante ? variante.id : null,
        variante: variante ? `${variante.atributo} ${variante.valor}` : null,
        nombre: producto.nombre,
        talle: producto.talle || null,
        precio: Number(producto.precio),
        cantidad: l.cantidad,
      });
      subtotal += Number(producto.precio) * l.cantidad;
    }

    // Reservar el stock AHORA (atómico, condicional). Si una línea se quedó
    // sin stock entre la validación y acá, se devuelve lo ya reservado y se
    // corta. Esto cierra la sobreventa de productos de stock 1.
    const reservadas = [];
    for (const it of itemsPedido) {
      const r = it.variante_id
        ? await sb.rpc('reservar_stock_variante', { p_variante_id: it.variante_id, p_cantidad: it.cantidad })
        : await sb.rpc('reservar_stock', { p_producto_id: it.producto_id, p_cantidad: it.cantidad });
      if (r.data === true) { reservadas.push(it); continue; }
      await devolverStock(sb, reservadas);
      const etq = it.variante ? `${it.nombre} (${it.variante})` : it.nombre;
      return fail(res, 409, `Se agotó ${etq} mientras comprabas. Probá de nuevo.`);
    }

    // Cupón (opcional): se "reserva" de forma atómica marcándolo usado. El tipo
    // y el descuento se derivan SIEMPRE server-side (nunca del cliente). No
    // acumulable: uno solo por pedido. Si falla, se suelta el stock reservado.
    const codigoCupon = (limpiar(body.cupon, 24) || '').toUpperCase() || null;
    let descuento = 0, envio = ENVIO_URUGUAY;
    if (codigoCupon) {
      const nowISO = new Date().toISOString();
      const { data: claim } = await sb.from('items_usuario')
        .update({ usado_en: nowISO })
        .eq('codigo', codigoCupon).eq('estado', 'canjeado').is('usado_en', null).gt('expira_en', nowISO)
        .select('tipo_item');
      if (!claim || !claim.length) {
        await devolverStock(sb, reservadas);
        return fail(res, 409, 'El cupón no es válido, ya se usó o venció.');
      }
      const tipo = claim[0].tipo_item;
      if (tipo === 'desc_200') descuento = 200;
      else if (tipo === 'desc_500') descuento = 500;
      else if (tipo === 'envio_gratis') envio = 0;
    }
    descuento = Math.min(descuento, subtotal);
    const montoTotal = (subtotal - descuento) + envio;

    const codigo = generarCodigoPedido();
    const venceEn = new Date(Date.now() + RESERVA_MIN * 60000).toISOString();

    const { data: pedido, error: e2 } = await sb
      .from('pedidos')
      .insert({
        codigo_publico: codigo,
        cliente_nombre: nombre,
        cliente_contacto: email,
        direccion_envio: direccion,
        productos: itemsPedido,
        monto_total: montoTotal,
        envio, descuento, cupon_codigo: codigoCupon,
        estado_pago: 'pendiente',
        estado_envio: 'preparando',
        stock_reservado: true,
        reserva_vence_en: venceEn,
      })
      .select('id,codigo_publico')
      .single();
    if (e2) { await devolverStock(sb, reservadas); await liberarCupon(sb, codigoCupon); throw e2; }

    // Items para MercadoPago: con descuento se colapsa a una línea "Productos"
    // (MP no admite líneas negativas); el envío va como su propia línea.
    const itemsMP = descuento > 0
      ? [{ id: codigo, nombre: 'Productos Chunky Snkrs', precio: subtotal - descuento, cantidad: 1 }]
      : itemsPedido.map((it) => ({
          id: it.variante_id || it.producto_id,
          nombre: it.variante ? `${it.nombre} (${it.variante})` : it.nombre,
          precio: it.precio, cantidad: it.cantidad,
        }));
    if (envio > 0) itemsMP.push({ id: 'envio', nombre: 'Envío (Uruguay)', precio: envio, cantidad: 1 });

    let pref;
    try {
      pref = await crearPreferencia({ items: itemsMP, codigoPedido: codigo, payerEmail: email });
    } catch (e) {
      // No se pudo generar la preferencia → soltar stock + cupón y anular el pedido.
      await devolverStock(sb, reservadas);
      await liberarCupon(sb, codigoCupon);
      await sb.from('pedidos').update({ estado_pago: 'rechazado', stock_reservado: false }).eq('id', pedido.id);
      throw e;
    }

    await sb.from('pedidos').update({ mp_preference_id: pref.id }).eq('id', pedido.id);

    json(res, 200, { ok: true, codigo, init_point: pref.init_point });
  } catch (err) {
    console.error('[crear-pago]', err.message);
    fail(res, 500, 'No se pudo iniciar el pago.');
  }
}

// Devuelve al stock lo reservado por un conjunto de líneas del pedido.
async function devolverStock(sb, items) {
  for (const it of items || []) {
    if (it.variante_id) await sb.rpc('devolver_stock_variante', { p_variante_id: it.variante_id, p_cantidad: it.cantidad || 1 });
    else await sb.rpc('devolver_stock', { p_producto_id: it.producto_id, p_cantidad: it.cantidad || 1 });
  }
}

// Suelta un cupón reservado (checkout fallido): vuelve a quedar disponible.
async function liberarCupon(sb, codigo) {
  if (codigo) await sb.from('items_usuario').update({ usado_en: null }).eq('codigo', codigo);
}
