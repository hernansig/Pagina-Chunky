/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — fondo urbano nocturno (negro opaco + rojo neón)
   Estética de la marca: nada de morado/azul/cian. Cielo negro con
   glow rojo, skyline con contorno neón rojo, grilla roja en el piso
   y brasas rojas flotando (como las partículas del sitio).
   El cielo se pre-renderiza una vez a un canvas offscreen.
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';
  const K = CR.K, pp = CR.pp, groundY = CR.groundY, sx = CR.sx;
  const W = K.W, H = K.H, HORIZON = K.HORIZON;
  const SW = W + 80, MARGIN = 40;

  let sky = null, floorGrad = null;
  const embers = [];

  function build() {
    sky = document.createElement('canvas');
    sky.width = SW; sky.height = HORIZON + 50;
    const g = sky.getContext('2d');

    // cielo negro opaco
    const grad = g.createLinearGradient(0, 0, 0, HORIZON);
    grad.addColorStop(0, '#050505'); grad.addColorStop(0.7, '#0a0606'); grad.addColorStop(1, '#170a0a');
    g.fillStyle = grad; g.fillRect(0, 0, SW, HORIZON + 50);

    // glow rojo de polución lumínica sobre el horizonte
    const rg = g.createRadialGradient(SW / 2, HORIZON, 8, SW / 2, HORIZON, 270);
    rg.addColorStop(0, 'rgba(139,0,0,0.55)'); rg.addColorStop(0.5, 'rgba(90,14,14,0.22)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, HORIZON - 270, SW, 310);

    // estrellas tenues (hueso / rojo)
    for (let i = 0; i < 70; i++) {
      g.globalAlpha = Math.random() * 0.4 + 0.12;
      g.fillStyle = Math.random() < 0.3 ? '#cc0000' : '#e8e0d0';
      g.fillRect((Math.random() * SW) | 0, (Math.random() * HORIZON * 0.6) | 0, 1, 1);
    }
    g.globalAlpha = 1;

    // skyline: edificios negros con contorno rojo neón + ventanas
    let x = -10;
    while (x < SW + 10) {
      const w = 26 + Math.random() * 62, h = 30 + Math.random() * 100, top = HORIZON - h;
      g.fillStyle = '#090909'; g.fillRect(x, top, w, h);
      g.strokeStyle = 'rgba(204,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
      g.fillStyle = Math.random() < 0.72 ? '#cc0000' : '#e8e0d0';
      for (let wy = top + 6; wy < HORIZON - 4; wy += 8)
        for (let wx = x + 4; wx < x + w - 4; wx += 7)
          if (Math.random() < 0.17) g.fillRect(wx, wy, 2, 3);
      if (Math.random() < 0.25) { g.fillStyle = '#8b0000'; g.fillRect(x + w / 2 - 1, top - 10, 2, 10); g.fillStyle = '#cc0000'; g.fillRect(x + w / 2 - 2, top - 12, 4, 3); }
      x += w + 5 + Math.random() * 12;
    }

    // remate rojo del horizonte
    const hg = g.createLinearGradient(0, HORIZON - 22, 0, HORIZON + 6);
    hg.addColorStop(0, 'rgba(204,0,0,0)'); hg.addColorStop(1, 'rgba(204,0,0,0.6)');
    g.fillStyle = hg; g.fillRect(0, HORIZON - 22, SW, 28);
  }

  // Cada brasa tiene una "profundidad" (0 lejos … 1 cerca): las cercanas suben
  // más rápido, son más grandes/brillantes y se desplazan más al mover la cámara
  // (parallax) → sensación de profundidad real.
  function mkEmber(start) {
    const depth = Math.random();
    return { x: Math.random() * W, y: start ? HORIZON + Math.random() * (H - HORIZON) : H + 8,
      vy: 8 + depth * 34, r: depth < 0.4 ? 1 : 2, a: 0.18 + depth * 0.45, red: Math.random() < 0.78, depth };
  }
  function init() { build(); floorGrad = null; embers.length = 0; for (let i = 0; i < 48; i++) embers.push(mkEmber(true)); }
  function update(dt) {
    for (const e of embers) {
      e.y -= e.vy * dt; e.x += Math.sin((e.y + e.x) * 0.02) * 6 * dt;
      if (e.y < HORIZON - 10) Object.assign(e, mkEmber(false));
    }
  }

  function drawSky(ctx, cam) { ctx.drawImage(sky, -cam * 14 - MARGIN, 0); }

  function glowLine(ctx, x0, y0, x1, y1, color, w, a) {
    ctx.lineCap = 'round'; ctx.strokeStyle = color;
    ctx.globalAlpha = 0.22 * a; ctx.lineWidth = w * 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.globalAlpha = a; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawFloor(ctx, cam, scroll) {
    if (!floorGrad) {
      floorGrad = ctx.createLinearGradient(0, HORIZON, 0, H);
      floorGrad.addColorStop(0, '#140707'); floorGrad.addColorStop(1, '#050303');
    }
    ctx.fillStyle = floorGrad; ctx.fillRect(0, HORIZON, W, H - HORIZON);

    const RED = '#cc0000', DRED = '#8b0000';
    // Las líneas de la calzada llegan hasta z=-0.5 (detrás del héroe): la
    // calle continúa en primer plano y el jugador no queda "al borde del mundo".
    const Z0 = -0.5;
    const verts = [-2.4, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2.4];
    for (const off of verts) {
      const bright = off === -1.5 || off === 1.5 || off === -0.5 || off === 0.5;
      const x0 = sx(off, Z0, cam), y0 = groundY(Z0);
      glowLine(ctx, x0, y0, W / 2, HORIZON, bright ? RED : DRED, bright ? 2.4 : 1, bright ? 0.8 : 0.28);
    }
    const gap = 0.6, phase = scroll % gap, eL = z => sx(-2.4, z, cam), eR = z => sx(2.4, z, cam);
    for (let z = gap - phase - gap * 2; z < 17; z += gap) {
      if (z < Z0) continue;
      const y = groundY(z), p = pp(z);
      glowLine(ctx, eL(z), y, eR(z), y, DRED, Math.max(1, 2.2 * p), Math.min(0.85, Math.max(0.12, 0.6 * p)));
    }
    ctx.fillStyle = 'rgba(204,0,0,0.5)'; ctx.fillRect(0, HORIZON - 1, W, 2);

    // brasas rojas de ambiente (con parallax por profundidad respecto de la cámara)
    for (const e of embers) {
      ctx.globalAlpha = e.a; ctx.fillStyle = e.red ? '#cc0000' : '#e8e0d0';
      ctx.fillRect((e.x + cam * e.depth * 46) | 0, e.y | 0, e.r, e.r);
    }
    ctx.globalAlpha = 1;
  }

  CR.Background = { init, update, drawSky, drawFloor };
})(window.CR);
