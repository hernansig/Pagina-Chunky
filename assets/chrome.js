/* ═══════════════════════════════════════════════════════════
   CHUNKY SNKRS — chrome compartido + helpers
   Inyecta: grano, fondo de partículas, grietas, ticker, nav y footer.
   Expone: window.CHK { money, toast, api }
   ═══════════════════════════════════════════════════════════ */
(function () {
  const IG = 'https://ig.me/m/chunkysnkrs.uy';

  // ── Helpers globales ──────────────────────────────────────
  const CHK = {
    money(n) {
      const v = Number(n);
      if (!isFinite(v)) return '$0';
      return '$' + v.toLocaleString('es-UY');
    },
    async api(path, opts = {}) {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data.error || 'Error de red.');
      return data;
    },
    toast(msg) {
      let t = document.querySelector('.toast');
      if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
      t.textContent = msg;
      requestAnimationFrame(() => t.classList.add('show'));
      clearTimeout(t._timer);
      t._timer = setTimeout(() => t.classList.remove('show'), 3200);
    },
    IG,
  };
  window.CHK = CHK;

  // ── Grano + canvas + grietas ──────────────────────────────
  function inyectarFondo() {
    const grain = document.createElement('div');
    grain.className = 'grain';
    document.body.prepend(grain);

    const canvas = document.createElement('canvas');
    canvas.id = 'bg';
    grain.after(canvas);

    const cracks = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cracks.setAttribute('class', 'cracks-svg');
    cracks.setAttribute('viewBox', '0 0 1440 900');
    cracks.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    cracks.setAttribute('aria-hidden', 'true');
    cracks.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
    cracks.innerHTML = CRACKS;
    canvas.after(cracks);

    animarFondo(canvas);
  }

  function animarFondo(canvas) {
    const ctx = canvas.getContext('2d');
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize(); window.addEventListener('resize', resize);

    const N = 70, pts = [];
    const mk = () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 1.8 + 0.4, op: Math.random() * 0.42 + 0.08,
      ph: Math.random() * Math.PI * 2, ps: 0.015 + Math.random() * 0.025,
      col: Math.random() > 0.5 ? '#8b0000' : '#cc0000',
    });
    for (let i = 0; i < N; i++) pts.push(mk());

    (function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const g = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.38, 0, canvas.width * 0.5, canvas.height * 0.5, canvas.height * 0.92);
      g.addColorStop(0, '#0f0404'); g.addColorStop(0.55, '#090909'); g.addColorStop(1, '#030303');
      ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d < 125) { ctx.save(); ctx.globalAlpha = (1 - d / 125) * 0.065; ctx.strokeStyle = '#8b0000'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); ctx.restore(); }
      }
      pts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.ph += p.ps;
        if (p.x < -6 || p.x > canvas.width + 6 || p.y < -6 || p.y > canvas.height + 6) Object.assign(p, mk());
        const a = p.op * (0.6 + 0.4 * Math.sin(p.ph));
        ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = p.col; ctx.shadowBlur = 7; ctx.shadowColor = p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      });
      requestAnimationFrame(draw);
    })();
  }

  // ── Nav ───────────────────────────────────────────────────
  function inyectarNav() {
    const path = location.pathname.replace(/\/$/, '') || '/';
    const links = [
      ['/', 'catálogo'],
      ['/encargos', 'encargos'],
      ['/minijuego', 'minijuego'],
      ['/ruleta', 'ruleta'],
      ['/pedido', 'rastrear'],
    ];
    const nav = document.createElement('nav');
    nav.className = 'nav';
    nav.innerHTML = `
      <a class="nav-logo" href="/">CHUNKY</a>
      <div class="nav-links">
        ${links.map(([href, txt]) => `<a href="${href}" class="${path === href ? 'activo' : ''}">${txt}</a>`).join('')}
      </div>`;
    const wrapper = document.querySelector('.wrapper') || document.body;
    const ticker = wrapper.querySelector('.ticker-wrap');
    if (ticker) ticker.after(nav); else wrapper.prepend(nav);
  }

  // ── Footer ────────────────────────────────────────────────
  function inyectarFooter() {
    if (document.querySelector('footer')) return;
    const f = document.createElement('footer');
    f.innerHTML = `
      <div class="footer-logo">Chunky Snkrs</div>
      <div class="footer-ig"><a href="${IG}" target="_blank" rel="noopener">@chunkysnkrs.uy</a></div>
      <div class="footer-contacto">Contacto: <a href="mailto:chunkysnkrs.uy@gmail.com">chunkysnkrs.uy@gmail.com</a> · @chunkysnkrs.uy</div>
      <div class="footer-links">
        <a href="/">catálogo</a><a href="/encargos">encargos</a>
        <a href="/pedido">rastrear pedido</a><a href="/minijuego">minijuego</a>
        <a href="/privacidad">política de privacidad</a><a href="/terminos">términos y condiciones</a>
      </div>
      <div class="footer-pagos">Los pagos son procesados por MercadoPago. No almacenamos datos de tarjetas.</div>
      <div class="footer-copy">© 2026 Chunky Snkrs — Uruguay · No se realizan cambios · Envíos 3 a 4 días hábiles</div>`;
    const wrapper = document.querySelector('.wrapper') || document.body;
    wrapper.appendChild(f);
  }

  // ── Banner de cookies ─────────────────────────────────────
  function inyectarCookies() {
    const KEY = 'chk_cookies_ok';
    try { if (localStorage.getItem(KEY)) return; } catch {}
    const banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Aviso de cookies');
    banner.innerHTML = `
      <p class="cookie-text">Este sitio usa cookies para funcionar correctamente y procesar pagos a través de MercadoPago. Al continuar navegando, aceptás su uso.</p>
      <div class="cookie-actions">
        <button class="cookie-btn" type="button">Aceptar</button>
        <a class="cookie-link" href="/privacidad">Ver política de privacidad</a>
      </div>`;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('show'));
    banner.querySelector('.cookie-btn').addEventListener('click', () => {
      try { localStorage.setItem(KEY, '1'); } catch {}
      banner.classList.remove('show');
      setTimeout(() => banner.remove(), 350);
    });
  }

  const CRACKS = `
  <defs><filter id="cglow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <g class="cg cg1" filter="url(#cglow)" stroke="#cc2222"><path stroke-width="1.6" d="M 0,45 L 62,88 L 92,168 L 78,248 L 125,318 L 108,402"/><path stroke-width="1.0" d="M 62,88 L 22,155 L 5,235"/><path stroke-width="1.0" d="M 92,168 L 152,192 L 198,262 L 188,330"/><path stroke-width="0.6" d="M 152,192 L 178,162 L 215,140"/><path stroke-width="0.6" d="M 125,318 L 162,335 L 178,405"/></g>
  <g class="cg cg2" filter="url(#cglow)" stroke="#cc2222"><path stroke-width="1.6" d="M 1440,35 L 1378,82 L 1335,158 L 1358,238 L 1298,308"/><path stroke-width="1.0" d="M 1378,82 L 1422,148 L 1440,222"/><path stroke-width="1.0" d="M 1335,158 L 1272,178 L 1238,248 L 1222,318"/></g>
  <g class="cg cg3" filter="url(#cglow)" stroke="#cc2222"><path stroke-width="1.4" d="M 720,450 L 658,382 L 602,308 L 562,232"/><path stroke-width="1.4" d="M 720,450 L 782,378 L 838,302 L 875,225"/><path stroke-width="1.2" d="M 720,450 L 738,532 L 720,615 L 748,695"/><path stroke-width="1.1" d="M 720,450 L 648,498 L 595,568"/><path stroke-width="1.1" d="M 720,450 L 792,502 L 845,572"/></g>
  <g class="cg cg4" filter="url(#cglow)" stroke="#cc2222"><path stroke-width="1.6" d="M 0,855 L 68,805 L 122,745 L 162,678 L 198,608"/><path stroke-width="1.0" d="M 68,805 L 25,758 L 0,705"/><path stroke-width="1.0" d="M 122,745 L 175,768 L 215,728 L 242,665"/></g>
  <g class="cg cg5" filter="url(#cglow)" stroke="#cc2222"><path stroke-width="1.6" d="M 1440,395 L 1378,422 L 1322,382 L 1265,418 L 1202,388"/><path stroke-width="1.0" d="M 1378,422 L 1398,478 L 1382,548 L 1402,615"/><path stroke-width="1.0" d="M 1322,382 L 1298,325 L 1262,278"/></g>`;

  // crack-pulse animation (inyectada por si la página no la define)
  const style = document.createElement('style');
  style.textContent = `
    .cg path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    @keyframes crack-pulse { 0%,100% { opacity:.4 } 50% { opacity:.88 } }
    .cg1{animation:crack-pulse 4.2s ease-in-out infinite}.cg2{animation:crack-pulse 5.8s ease-in-out infinite 1.3s}
    .cg3{animation:crack-pulse 3.7s ease-in-out infinite 2.1s}.cg4{animation:crack-pulse 6.1s ease-in-out infinite .7s}
    .cg5{animation:crack-pulse 4.9s ease-in-out infinite 3.2s}`;
  document.head.appendChild(style);

  function init() { inyectarFondo(); inyectarNav(); inyectarFooter(); inyectarCookies(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
