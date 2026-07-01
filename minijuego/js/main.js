/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — bootstrap + bucle principal
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';

  // Ajusta #wrap para que tenga EXACTO el aspecto del buffer y entre en la
  // pantalla. Así el canvas (100%×100%) nunca se deforma, aunque el navegador
  // ignore object-fit. Deja barras del color de fondo si el device es más/menos
  // alto que el buffer, pero NUNCA estira.
  function fitWrap() {
    const wrap = document.getElementById('wrap');
    if (!wrap) return;
    const mobile = !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
    const a = CR.K.W / CR.K.H;                                   // aspecto del buffer
    const availW = window.innerWidth * (mobile ? 1 : 0.96);
    const availH = window.innerHeight * (mobile ? 1 : 0.94);
    let w = availW, h = w / a;
    if (h > availH) { h = availH; w = h * a; }
    wrap.style.width = Math.round(w) + 'px';
    wrap.style.height = Math.round(h) + 'px';
  }

  function boot() {
    const canvas = document.getElementById('game');
    canvas.width = CR.K.W; canvas.height = CR.K.H;   // buffer vertical (config.js)
    fitWrap();
    window.addEventListener('resize', fitWrap);
    window.addEventListener('orientationchange', fitWrap);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    CR.ctx = ctx;

    CR.Background.init();
    CR.Game.init();
    CR.Board.render(null);
    CR.Input.bind();

    let last = performance.now();
    function frame(ts) {
      const dt = Math.min(0.034, (ts - last) / 1000 || 0); last = ts;
      CR.Audio.tick();
      CR.Background.update(dt);
      CR.Game.tick(dt);
      CR.Game.render();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.CR);
