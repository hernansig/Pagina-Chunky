/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — input (teclado + táctil) y cableado de la UI
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';
  const Game = CR.Game, Audio = CR.Audio;

  function bind() {
    const canvas = document.getElementById('game');
    const muteBtn = document.getElementById('muteBtn');

    // En móvil: pantalla completa + bloquear orientación al empezar a jugar.
    function enterImmersive() {
      if (!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches)) return;
      try { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
      try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) {}
    }
    document.getElementById('playBtn').addEventListener('click', () => { enterImmersive(); Game.start(); });
    document.getElementById('againBtn').addEventListener('click', () => Game.start());

    function toggleMute() {
      const m = Audio.toggleMute();
      muteBtn.textContent = m ? '✕' : '♪';
      muteBtn.style.color = m ? '#cc0000' : '';
    }
    muteBtn.addEventListener('click', toggleMute);

    // ── teclado ──
    window.addEventListener('keydown', e => {
      const k = e.key;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
      if (e.repeat) return;
      Audio.resume();
      if (k.toLowerCase() === 'm') { toggleMute(); return; }
      const st = Game.getState();
      if (st === 'start') { if (k === ' ' || k === 'Enter') Game.start(); return; }
      if (st === 'over') { if (k === 'Enter') Game.start(); return; }
      const kk = k.toLowerCase();
      if (k === 'ArrowLeft' || kk === 'a') Game.moveLane(-1);
      else if (k === 'ArrowRight' || kk === 'd') Game.moveLane(1);
      else if (k === 'ArrowUp' || kk === 'w' || k === ' ') Game.jump();
    });

    // ── táctil (swipe / tap) ──
    let tsx = 0, tsy = 0;
    canvas.addEventListener('touchstart', e => { const t = e.changedTouches[0]; tsx = t.clientX; tsy = t.clientY; Audio.resume(); }, { passive: true });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });   // que no se deslice la página
    canvas.addEventListener('touchend', e => {
      const st = Game.getState();
      if (st !== 'playing') { if (st === 'start') Game.start(); return; }
      const t = e.changedTouches[0], dx = t.clientX - tsx, dy = t.clientY - tsy;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { Game.jump(); return; }
      if (Math.abs(dx) > Math.abs(dy)) Game.moveLane(dx > 0 ? 1 : -1);
      else if (dy < 0) Game.jump();
    }, { passive: true });
  }

  CR.Input = { bind };
})(window.CR);
