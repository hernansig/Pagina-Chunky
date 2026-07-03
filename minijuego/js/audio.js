/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — motor de audio (Web Audio API, sintetizado)
   · SFX chiptune + música de fondo en loop (bajo + arpegio).
   · Desbloqueo robusto para iPhone/iOS: el AudioContext se crea/reanuda
     DENTRO del gesto del usuario, y se reproduce un <audio> mudo en loop
     para que iOS enrute el WebAudio al canal multimedia (si no, el switch
     de silencio del iPhone apaga el sonido).
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';

  let actx = null, master = null, muted = false, cursor = 0;
  let silentEl = null;                       // <audio> mudo (bypass switch iOS)
  let musicGain = null, musicTimer = null, step = 0;

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

  // WAV mudo cortito como Blob URL (para el <audio> desbloqueador de iOS).
  function silentWavUrl() {
    const sr = 8000, n = sr * 0.25;          // 0.25 s de silencio, 16-bit mono
    const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    let p = 0;
    const str = s => { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
    const u32 = v => { dv.setUint32(p, v, true); p += 4; };
    const u16 = v => { dv.setUint16(p, v, true); p += 2; };
    str('RIFF'); u32(36 + n * 2); str('WAVE');
    str('fmt '); u32(16); u16(1); u16(1); u32(sr); u32(sr * 2); u16(2); u16(16);
    str('data'); u32(n * 2);                 // resto queda en 0 = silencio
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // Desbloquea el audio. Idempotente: seguro de llamar en cada gesto.
  function unlock() {
    const ac = ensure();
    if (ac.state === 'suspended') ac.resume();
    // buffer mudo de 1 sample (desbloqueo estándar de WebAudio en iOS)
    try {
      const b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource();
      s.buffer = b; s.connect(ac.destination); s.start(0);
    } catch (e) {}
    // <audio> mudo en loop → iOS pasa a categoría "playback": el WebAudio suena
    // aunque el iPhone esté en silencio.
    try {
      if (!silentEl) {
        silentEl = new Audio(silentWavUrl());
        silentEl.loop = true; silentEl.playsInline = true;
        silentEl.setAttribute('playsinline', '');
      }
      const pr = silentEl.play(); if (pr && pr.catch) pr.catch(() => {});
    } catch (e) {}
  }

  function resume() { unlock(); }            // compat con input.js/game.js

  function tone(o) {
    if (muted) return;
    try {
      const ac = ensure();
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      // separar disparos: si caen muchos juntos (fila de monedas) suenan como
      // arpegio en vez de pisarse y "perderse".
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

  // ── Música de fondo (chiptune en loop: bajo + arpegio) ──────────
  const A2 = 110, C3 = 130.81, D3 = 146.83, E3 = 164.81, G3 = 196, A3 = 220,
        C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392, A4 = 440;
  const BASS = [A2, 0, A2, 0, G3, 0, G3, 0, C3, 0, C3, 0, D3, 0, D3, 0];
  const LEAD = [A3, C4, E4, C4, G3, C4, E4, G4, C4, E4, G4, E4, D4, E4, G4, A4];

  function mnote(freq, dur, type, vol) {
    if (!freq || !musicGain) return;
    const ac = actx, t = ac.currentTime + 0.03;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(musicGain);
    osc.start(t); osc.stop(t + dur + 0.03);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
  }
  function musicStep() {
    mnote(BASS[step % BASS.length], 0.24, 'square', 0.05);
    mnote(LEAD[step % LEAD.length], 0.16, 'triangle', 0.035);
    step++;
  }
  function startMusic() {
    if (musicTimer) return;
    const ac = ensure();
    if (!musicGain) { musicGain = ac.createGain(); musicGain.gain.value = muted ? 0 : 0.6; musicGain.connect(master); }
    step = 0; musicStep();
    musicTimer = setInterval(musicStep, 190);   // ~1 paso cada 190 ms
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

  // mantiene el cursor pegado al presente entre frames (no se adelanta)
  function tick() { if (actx) cursor = Math.max(cursor - 0.0001, actx.currentTime); }

  // Red de seguridad: desbloquear en el primer gesto en cualquier parte.
  ['touchend', 'pointerdown', 'click', 'keydown'].forEach(ev =>
    window.addEventListener(ev, unlock, { passive: true }));

  CR.Audio = {
    resume, unlock, tick, startMusic, stopMusic,
    toggleMute() {
      muted = !muted;
      if (musicGain) musicGain.gain.value = muted ? 0 : 0.6;
      return muted;
    },
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
