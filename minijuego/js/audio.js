/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — motor de audio (Web Audio API, sintetizado)
   Robusto: un solo AudioContext + master gain, envolventes con
   setValueAtTime y un "cursor" que separa disparos para que NUNCA
   colisionen en el scheduler (causa del bug del sonido de monedas).
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';

  let actx = null, master = null, muted = false, cursor = 0;

  function ensure() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.85;
      master.connect(actx.destination);
    }
    return actx;
  }

  // Crea el AudioContext DENTRO del gesto del usuario (requisito de iOS/Android:
  // si no, arranca 'suspended' y el sonido no suena en el celular).
  function resume() {
    const ac = ensure();
    if (ac.state === 'suspended') ac.resume();
  }

  function tone(o) {
    if (muted) return;
    try {
      const ac = ensure();
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      // separar disparos: si caen muchos juntos (fila de monedas), suenan
      // como arpegio en vez de pisarse y "perderse".
      const t = Math.max(now, cursor);
      cursor = t + 0.014;

      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.d);

      const v = o.v || 0.05;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.008);   // ataque corto (sin clicks)
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);

      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + o.d + 0.03);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    } catch (e) {}
  }

  // mantiene el cursor pegado al presente entre frames (no se adelanta)
  function tick() { if (actx) cursor = Math.max(cursor - 0.0001, actx.currentTime); }

  CR.Audio = {
    resume, tick,
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },
    sfx: {
      coin() { tone({ f: 880, f2: 1500, d: 0.09, type: 'square', v: 0.05 }); },
      jump() { tone({ f: 300, f2: 680, d: 0.16, type: 'square', v: 0.05 }); },
      lane() { tone({ f: 210, f2: 250, d: 0.05, type: 'square', v: 0.03 }); },
      good() { tone({ f: 520, f2: 1040, d: 0.20, type: 'triangle', v: 0.06 }); },
      bad()  { tone({ f: 360, f2: 140, d: 0.24, type: 'sawtooth', v: 0.06 }); },
      hit()  { tone({ f: 180, f2: 50, d: 0.40, type: 'sawtooth', v: 0.09 }); },
    },
  };
})(window.CR);
