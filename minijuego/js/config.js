/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — config + helpers compartidos
   Namespace global CR (scripts clásicos: funciona por file:// y server).
   ════════════════════════════════════════════════════════════════ */
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  // ── Formato VERTICAL (portrait) adaptativo ──────────────────────
  // Ancho interno fijo = 960 → preserva EXACTO el tuning de carriles,
  // sprites y físicas. El alto se adapta al aspecto de pantalla para llenar
  // el celular sin deformar: en móvil usamos siempre el aspecto vertical del
  // device (aunque esté de costado), en desktop un marco 9:16.
  const W = 960;
  const MOBILE = !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
  function altoVertical() {
    let r;  // alto / ancho
    if (MOBILE) {
      const a = window.innerWidth || 400, b = window.innerHeight || 800;
      r = Math.max(a, b) / Math.min(a, b);   // aspecto vertical del device
    } else {
      r = 16 / 9;                            // marco vertical en desktop
    }
    r = Math.min(2.0, Math.max(1.4, r));     // clamp a un vertical sensato (no tan estirado)
    return Math.round(W * r);
  }
  const H = altoVertical();
  // En celular ACERCAMOS la cámara: carriles más anchos + sprites más grandes,
  // para que los obstáculos se vean mejor (el buffer 960 se muestra chico en el
  // teléfono). En desktop se mantiene el tuning original.
  const LANE = MOBILE ? 188 : 168;

  CR.K = {
    W, H,
    HORIZON: Math.round(H * 0.30),  // y del punto de fuga (~30% desde arriba)
    NEAR_Y: Math.round(H * 0.88),   // y del piso a z=0 (deja piso en primer plano; sube al jugador)
    CAM: 2.3,             // constante de cámara (perspectiva)
    LANE_DX: LANE,        // separación de carriles (cerca)
    ROAD_HALF: LANE * 1.5, // medio ancho de calzada
    PLAYER_X: W / 2,
    PLAYER_Z: 0.15,       // profundidad de dibujo del héroe
    HIT_Z: 0.2,           // plano donde se evalúa el choque
    COLLECT_Z: 0.6,       // ventana de recolección de monedas/power-ups (ancha = más frames para alinearse)
    REMOVE_Z: 0.06,
    OBJ_SCALE: MOBILE ? 2.15 : 1.7, PLAYER_SCALE: MOBILE ? 2.25 : 1.85,
    BASE_Z: 3.2, CAP_Z: 9.5, MULT_MAX: 1.5,  // velocidad en z/seg (arranca y sube más rápido)
    SPEED_RAMP: 0.22,                         // +z/seg por segundo de partida
    METERS: 3.2,                              // z → metros (distancia para ranking mensual)
    JUMP_V: 457, GRAV: 1306,                  // físicas del salto (apex ~80)
    ZFAR: { garbage: 9, zombie: 10, moto: 13, coin: 9, power: 9 },
    STORE_KEY: 'chunky_mvd_scores',
  };

  // ── Matemática de perspectiva ─────────────────────────────────
  CR.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  CR.pp = z => CR.K.CAM / (z + CR.K.CAM);                                  // 1 cerca → 0 lejos
  CR.groundY = z => CR.K.HORIZON + (CR.K.NEAR_Y - CR.K.HORIZON) * CR.pp(z);
  CR.sx = (off, z, cam) => W / 2 + (off - cam) * CR.K.LANE_DX * CR.pp(z);  // héroe (off=cam) queda centrado

  // ── Helpers de dibujo (usan CR.ctx, fijado por main.js) ───────
  CR.R = function (x, y, w, h, c) {
    const ctx = CR.ctx; ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  CR.pf = function (t, x, y, size, color, align) {
    const ctx = CR.ctx;
    ctx.font = size + 'px "Press Start 2P", monospace';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = color; ctx.fillText(t, x, y);
  };
  CR.shadow = function (cx, gy, w, a) {
    if (w <= 0 || a <= 0) return;
    const ctx = CR.ctx; ctx.fillStyle = 'rgba(0,0,0,' + a + ')';
    ctx.beginPath(); ctx.ellipse(cx, gy, w, w * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  };
  CR.billboard = function (cx, baseY, s, fn) {
    const ctx = CR.ctx; ctx.save(); ctx.translate(cx, baseY); ctx.scale(s, s); fn(); ctx.restore();
  };
})(window.CR);
