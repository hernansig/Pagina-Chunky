/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — bootstrap + bucle principal
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';

  function boot() {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    CR.ctx = ctx;

    CR.Background.init();
    CR.Game.init();
    CR.Board.render(null);
    CR.Input.bind();

    let last = performance.now();
    function frame(ts) {
      const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
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
