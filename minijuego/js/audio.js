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
  let musicEl = null;                        // <audio> de música de fondo (mp3 opcional)

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

  // ── Música de fondo (archivo mp3 opcional, por ahora SIN música) ──
  // Estructura lista: para activar la música basta con subir el archivo a
  // /assets/music.mp3 (carpeta compartida del sitio, se sirve en esa URL).
  // Si el archivo no existe, el catch silencioso deja el juego sin música
  // (los SFX siguen andando). startMusic() se llama SIEMPRE dentro de un
  // gesto del usuario (botón JUGAR) → cumple la política de autoplay móvil.
  const MUSIC_URL = '/assets/music.mp3';
  function startMusic() {
    try {
      if (!musicEl) {
        musicEl = new Audio(MUSIC_URL);
        musicEl.loop = true; musicEl.volume = 0.55;
        musicEl.playsInline = true; musicEl.setAttribute('playsinline', '');
        musicEl.addEventListener('error', () => { musicEl = null; });  // 404 → sin música
      }
      musicEl.muted = muted;
      const pr = musicEl.play(); if (pr && pr.catch) pr.catch(() => {});
    } catch (e) {}
  }
  function stopMusic() {
    if (!musicEl) return;
    try { musicEl.pause(); musicEl.currentTime = 0; } catch (e) {}
  }

  // mantiene el cursor pegado al presente entre frames (no se adelanta)
  function tick() { if (actx) cursor = Math.max(cursor - 0.0001, actx.currentTime); }

  // Red de seguridad: desbloquear en el primer gesto en cualquier parte.
  ['touchend', 'pointerdown', 'click', 'keydown'].forEach(ev =>
    window.addEventListener(ev, unlock, { passive: true }));

  CR.Audio = {
    resume, unlock, tick, startMusic, stopMusic,
    toggleMute() {
      muted = !muted;
      if (musicEl) musicEl.muted = muted;
      return muted;
    },
    isMuted() { return muted; },
    sfx: {
      // La moneda sube de tono con el combo (chiptune "arpegio" al encadenar).
      coin(step) {
        const s = Math.min(step || 0, 14);
        const base = 760 + s * 42;
        tone({ f: base, f2: base * 1.7 + 200, d: 0.09, type: 'square', v: 0.05 });
      },
      jump() { tone({ f: 300, f2: 680, d: 0.16, type: 'square', v: 0.05 }); },
      lane() { tone({ f: 210, f2: 250, d: 0.05, type: 'square', v: 0.03 }); },
      power() { tone({ f: 500, f2: 900, d: 0.10, type: 'triangle', v: 0.05 }); tone({ f: 780, f2: 1320, d: 0.14, type: 'square', v: 0.04 }); },
      checkpoint() { [523, 659, 784, 1046].forEach((f) => tone({ f, f2: f * 1.02, d: 0.16, type: 'square', v: 0.05 })); },  // arpegio ascendente celebratorio
      good() { tone({ f: 520, f2: 1040, d: 0.20, type: 'triangle', v: 0.06 }); },
      bad()  { tone({ f: 360, f2: 140, d: 0.24, type: 'sawtooth', v: 0.06 }); },
      hit()  { tone({ f: 180, f2: 50, d: 0.40, type: 'sawtooth', v: 0.09 }); },
    },
  };
})(window.CR);
