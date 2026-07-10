/* ═══════════════════════════════════════════════════════════
   CHUNKY SNKRS — carrito de compras
   · Persistencia en localStorage (sobrevive recargas).
   · Drawer lateral con items, cantidades y total.
   · Checkout: POST /api/crear-pago con TODOS los items → MercadoPago.
     Los precios reales los recalcula el backend desde la base; acá solo
     viajan producto_id / variante_id / cantidad.
   Expone window.CHKCart { add, remove, setQty, items, count, total, open, close, clear }.
   Lo carga chrome.js en todas las páginas (el badge vive en el nav).
   ═══════════════════════════════════════════════════════════ */
(function () {
  if (window.CHKCart) return;
  const KEY = 'chk_cart';
  const CUPON_KEY = 'chk_cupon';
  const ENVIO = 290;   // envío fijo a todo Uruguay (debe coincidir con crear-pago.js)

  // Cupón aplicado (código + efecto), persistido para sobrevivir recargas.
  function getCupon() {
    try { const v = JSON.parse(localStorage.getItem(CUPON_KEY) || 'null'); return v && v.codigo ? v : null; } catch { return null; }
  }
  function setCupon(c) { try { localStorage.setItem(CUPON_KEY, JSON.stringify(c)); } catch {} }
  function clearCupon() { try { localStorage.removeItem(CUPON_KEY); } catch {} }
  const fmt = (n) => (window.CHK ? CHK.money(n) : '$' + n);

  function leer() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  function guardar(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
    refreshBadge();
    if (drawer && drawer.classList.contains('abierto')) renderItems();
  }
  const lineKey = (l) => l.producto_id + '|' + (l.variante_id || '');

  // ── API pública ───────────────────────────────────────────
  function add(item) {
    const items = leer();
    const k = lineKey(item);
    const ya = items.find((l) => lineKey(l) === k);
    if (ya) ya.cantidad = Math.min(10, (ya.cantidad || 1) + (item.cantidad || 1));
    else items.push({ ...item, cantidad: Math.min(10, item.cantidad || 1) });
    guardar(items);
  }
  function remove(k) { guardar(leer().filter((l) => lineKey(l) !== k)); }
  function setQty(k, qty) {
    const items = leer();
    const l = items.find((x) => lineKey(x) === k);
    if (!l) return;
    l.cantidad = Math.min(10, Math.max(1, qty | 0));
    guardar(items);
  }
  function clear() { guardar([]); }
  const items = () => leer();
  const count = () => leer().reduce((a, l) => a + (l.cantidad || 1), 0);
  const total = () => leer().reduce((a, l) => a + Number(l.precio || 0) * (l.cantidad || 1), 0);

  // ── Badge del nav ─────────────────────────────────────────
  function refreshBadge() {
    const b = document.querySelector('.cart-badge');
    if (!b) return;
    const n = count();
    b.textContent = n;
    b.style.display = n > 0 ? '' : 'none';
  }

  // ── Drawer ────────────────────────────────────────────────
  let drawer = null, overlay = null;
  function montar() {
    if (drawer) return;
    overlay = document.createElement('div');
    overlay.className = 'cart-overlay';
    overlay.addEventListener('click', close);
    drawer = document.createElement('aside');
    drawer.className = 'cart-drawer';
    drawer.innerHTML = `
      <div class="cart-head">
        <span class="cart-title">TU <span>CARRITO</span></span>
        <button class="cart-close" aria-label="cerrar">&times;</button>
      </div>
      <div class="cart-items"></div>
      <div class="cart-foot">
        <div class="cart-cupon">
          <input class="cart-cupon-input" placeholder="CÓDIGO DE CUPÓN" maxlength="24" autocomplete="off">
          <button class="cart-cupon-btn" type="button">Aplicar</button>
        </div>
        <div class="cart-cupon-msg"></div>
        <div class="cart-breakdown">
          <div class="cb-row"><span>Subtotal</span><span class="cb-subtotal">$0</span></div>
          <div class="cb-row cb-desc" style="display:none"><span>Descuento</span><span class="cb-descuento">-$0</span></div>
          <div class="cb-row"><span>Envío</span><span class="cb-envio">$0</span></div>
        </div>
        <div class="cart-total-row"><span>Total</span><span class="cart-total">$0</span></div>
        <button class="btn big cart-comprar"><span>Comprar</span></button>
        <div class="cart-form" style="display:none">
          <div class="form-field"><label class="form-label">Nombre y apellido</label><input class="form-input" data-f="nombre" placeholder="Tu nombre"></div>
          <div class="form-field"><label class="form-label">Tu email</label><input class="form-input" data-f="email" type="email" placeholder="tu@mail.com"></div>
          <div class="form-field"><label class="form-label">Dirección (calle y número)</label><input class="form-input" data-f="calle" placeholder="Av. Italia 1234"></div>
          <div class="cart-form-2col">
            <div class="form-field"><label class="form-label">Ciudad</label><input class="form-input" data-f="ciudad" placeholder="Montevideo"></div>
            <div class="form-field"><label class="form-label">Departamento</label><input class="form-input" data-f="departamento" placeholder="Montevideo"></div>
          </div>
          <div class="cart-form-2col">
            <div class="form-field"><label class="form-label">Código postal</label><input class="form-input" data-f="cp" placeholder="11000"></div>
            <div class="form-field"><label class="form-label">Teléfono</label><input class="form-input" data-f="telefono" type="tel" placeholder="09X XXX XXX"></div>
          </div>
          <div class="form-field"><label class="form-label">Referencias (opcional)</label><input class="form-input" data-f="notas" placeholder="Apto, esquina..."></div>
          <button class="btn big cart-pagar"><span>Ir a pagar</span></button>
          <p class="aviso-pago">Los pagos son procesados de forma segura por MercadoPago. Tu pedido se confirma únicamente cuando MercadoPago notifica el pago exitoso.</p>
        </div>
        <div class="modal-msg cart-msg"></div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    drawer.querySelector('.cart-close').addEventListener('click', close);
    drawer.querySelector('.cart-comprar').addEventListener('click', () => {
      if (!count()) return;
      drawer.querySelector('.cart-comprar').style.display = 'none';
      drawer.querySelector('.cart-form').style.display = '';
      drawer.querySelector('[data-f="email"]').focus();
    });
    drawer.querySelector('.cart-pagar').addEventListener('click', pagar);
    drawer.querySelector('.cart-cupon-btn').addEventListener('click', aplicarCupon);
    drawer.querySelector('.cart-cupon-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicarCupon(); });
  }

  function esc(s = '') { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ── Cupón + desglose de totales ───────────────────────────
  function renderTotals() {
    if (!drawer) return;
    const sub = total(), hayItems = count() > 0, cupon = getCupon();
    let envio = hayItems ? ENVIO : 0, desc = 0;
    if (cupon && hayItems) {
      if (cupon.envio_gratis) envio = 0;
      desc = Math.min(cupon.descuento || 0, sub);
    }
    const tot = Math.max(0, sub - desc) + envio;
    drawer.querySelector('.cb-subtotal').textContent = fmt(sub);
    drawer.querySelector('.cb-desc').style.display = desc > 0 ? '' : 'none';
    drawer.querySelector('.cb-descuento').textContent = '-' + fmt(desc);
    drawer.querySelector('.cb-envio').textContent = (cupon && cupon.envio_gratis && hayItems) ? 'GRATIS' : fmt(envio);
    drawer.querySelector('.cart-total').textContent = fmt(tot);
    const btn = drawer.querySelector('.cart-cupon-btn'), inp = drawer.querySelector('.cart-cupon-input');
    btn.textContent = cupon ? 'Quitar' : 'Aplicar';
    inp.disabled = !!cupon;
    if (cupon) inp.value = cupon.codigo;
  }

  async function aplicarCupon() {
    const inp = drawer.querySelector('.cart-cupon-input'), cmsg = drawer.querySelector('.cart-cupon-msg');
    cmsg.className = 'cart-cupon-msg';
    if (getCupon()) { clearCupon(); cmsg.textContent = ''; renderTotals(); return; }   // quitar
    const codigo = (inp.value || '').trim().toUpperCase();
    if (!codigo) return;
    cmsg.textContent = 'Validando...';
    try {
      const r = await CHK.api('/api/app/validar-cupon', { method: 'POST', body: { codigo } });
      setCupon({ codigo: r.codigo, tipo: r.tipo, descuento: r.descuento, envio_gratis: r.envio_gratis, etiqueta: r.etiqueta });
      cmsg.textContent = '✓ ' + r.etiqueta + ' aplicado';
      renderTotals();
    } catch (e) { cmsg.className = 'cart-cupon-msg error'; cmsg.textContent = e.message; }
  }

  // Re-valida el cupón guardado al abrir (puede haber vencido o usado).
  async function revalidarCupon() {
    const c = getCupon(); if (!c) { renderTotals(); return; }
    try {
      const r = await CHK.api('/api/app/validar-cupon', { method: 'POST', body: { codigo: c.codigo } });
      setCupon({ codigo: r.codigo, tipo: r.tipo, descuento: r.descuento, envio_gratis: r.envio_gratis, etiqueta: r.etiqueta });
    } catch { clearCupon(); }
    renderTotals();
  }

  function renderItems() {
    const cont = drawer.querySelector('.cart-items');
    const lista = leer();
    if (!lista.length) {
      cont.innerHTML = '<div class="cart-vacio">Tu carrito está vacío.<br>Agregá algo del catálogo 👟</div>';
    } else {
      cont.innerHTML = lista.map((l) => {
        const k = lineKey(l);
        return `
        <div class="cart-item" data-k="${esc(k)}">
          ${l.foto_url ? `<img src="${esc(l.foto_url)}" alt="" loading="lazy">` : '<div class="cart-item-ph"></div>'}
          <div class="cart-item-info">
            <div class="cart-item-name">${esc(l.nombre)}</div>
            ${l.variante ? `<div class="cart-item-var">${esc(l.variante)}</div>` : ''}
            <div class="cart-item-precio">${window.CHK ? CHK.money(l.precio) : '$' + l.precio}</div>
          </div>
          <div class="cart-item-qty">
            <button class="qty-btn menos" aria-label="menos">−</button>
            <span>${l.cantidad || 1}</span>
            <button class="qty-btn mas" aria-label="más">+</button>
          </div>
          <button class="cart-item-x" aria-label="quitar">&times;</button>
        </div>`;
      }).join('');
      cont.querySelectorAll('.cart-item').forEach((el) => {
        const k = el.dataset.k;
        el.querySelector('.menos').addEventListener('click', () => {
          const cur = (leer().find((x) => lineKey(x) === k) || {}).cantidad || 1;
          if (cur <= 1) remove(k); else setQty(k, cur - 1);
        });
        el.querySelector('.mas').addEventListener('click', () => {
          const cur = (leer().find((x) => lineKey(x) === k) || {}).cantidad || 1;
          setQty(k, cur + 1);
        });
        el.querySelector('.cart-item-x').addEventListener('click', () => remove(k));
      });
    }
    renderTotals();
    drawer.querySelector('.cart-comprar').style.display = lista.length ? '' : 'none';
    if (!lista.length) drawer.querySelector('.cart-form').style.display = 'none';
  }

  function open() {
    montar(); renderItems(); revalidarCupon();
    overlay.classList.add('abierto');
    drawer.classList.add('abierto');
  }
  function close() {
    if (!drawer) return;
    overlay.classList.remove('abierto');
    drawer.classList.remove('abierto');
  }

  // ── Checkout de todo el carrito ───────────────────────────
  async function pagar() {
    const msg = drawer.querySelector('.cart-msg');
    msg.className = 'modal-msg cart-msg'; msg.textContent = '';
    const f = (n) => drawer.querySelector(`[data-f="${n}"]`).value.trim();
    const email = f('email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.classList.add('error'); msg.textContent = 'Poné un email válido.'; return; }
    const direccion = { calle: f('calle'), ciudad: f('ciudad'), departamento: f('departamento'), cp: f('cp'), telefono: f('telefono'), notas: f('notas') };
    if (!direccion.calle || !direccion.ciudad || !direccion.departamento || !direccion.telefono) {
      msg.classList.add('error'); msg.textContent = 'Completá dirección, ciudad, departamento y teléfono.'; return;
    }
    const btn = drawer.querySelector('.cart-pagar');
    btn.disabled = true; btn.querySelector('span').textContent = 'Procesando...';
    try {
      const body = {
        items: leer().map((l) => ({ producto_id: l.producto_id, variante_id: l.variante_id || null, cantidad: l.cantidad || 1 })),
        nombre: f('nombre'), email, direccion,
        cupon: (getCupon() || {}).codigo || null,
      };
      const r = await CHK.api('/api/crear-pago', { method: 'POST', body });
      window.location.href = r.init_point;
    } catch (e) {
      msg.classList.add('error'); msg.textContent = e.message;
      btn.disabled = false; btn.querySelector('span').textContent = 'Ir a pagar';
    }
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    // botón del nav (inyectado por chrome.js)
    const btn = document.querySelector('.nav-cart');
    if (btn) btn.addEventListener('click', open);
    refreshBadge();
    // pago confirmado → vaciar el carrito y el cupón usado
    if (location.pathname.replace(/\/$/, '') === '/pedido-confirmado') { clear(); clearCupon(); }
    // sincronizar entre pestañas
    window.addEventListener('storage', (e) => { if (e.key === KEY) refreshBadge(); });
  }

  window.CHKCart = { add, remove, setQty, clear, items, count, total, open, close, refreshBadge };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
