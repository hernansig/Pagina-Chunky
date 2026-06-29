/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — núcleo del juego (estado, spawns, update, render)
   Puntaje = monedas. Los metros se guardan aparte (ranking mensual).
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';
  const K = CR.K, pp = CR.pp, groundY = CR.groundY, sx = CR.sx, clamp = CR.clamp;
  const R = CR.R, pf = CR.pf, shadow = CR.shadow, billboard = CR.billboard;
  const S = CR.Sprites, BG = CR.Background, Audio = CR.Audio, Board = CR.Board;
  const W = K.W, H = K.H, HORIZON = K.HORIZON;
  const BONE = '#e8e0d0', RED = '#cc0000', REDM = '#ff3a3a', MUTED = '#5a5a5a';

  let state = 'start';     // 'start' | 'playing' | 'over'
  let game = null;
  let vignette = null;

  function rnd(n) { return (Math.random() * n) | 0; }

  // ── Estado de partida ─────────────────────────────────────────
  function newGame() {
    return {
      t: 0, dist: 0, coins: 0, speed: K.BASE_Z, scroll: 0, cam: 0,
      player: { lane: 1, px: 0, jumping: false, jumpVel: 0, jumpOff: 0, hopT: 0, shield: false, invuln: 0, run: 0 },
      obstacles: [], coinsArr: [], powerups: [], particles: [], pops: [],
      spawnT: 1.0, coinT: 0.8, powerT: 7,
      fx: { mult: 1, sTimer: 0, sLabel: null, sGood: true, rainTimer: 0 },
      banner: null, shake: 0, coinFlash: 0, finalCoins: 0, finalMetros: 0, saved: false,
    };
  }

  // ── Acciones de input ─────────────────────────────────────────
  function moveLane(d) {
    if (state !== 'playing') return;
    const p = game.player, nl = clamp(p.lane + d, 0, 2);
    if (nl !== p.lane) { p.lane = nl; p.hopT = 0.18; Audio.sfx.lane(); }
  }
  function jump() {
    if (state !== 'playing') return;
    const p = game.player;
    if (!p.jumping) { p.jumping = true; p.jumpVel = K.JUMP_V; Audio.sfx.jump(); }
  }

  function burst(x, y, color, n) {
    const a = game.particles;
    for (let i = 0; i < n; i++)
      a.push({ x, y, vx: (Math.random() - 0.5) * 320, vy: -Math.random() * 300, life: 0.5, color, s: 2 + Math.random() * 2 });
  }
  function pop(x, y, text, color) { game.pops.push({ x, y, text, color, life: 0.9 }); }
  function banner(text, color) { game.banner = { text, color, t: 1.7 }; }

  // ── Spawns ────────────────────────────────────────────────────
  function laneOccupied(lane) { return game.obstacles.some(o => o.lane === lane && o.z > 6.0); }

  function spawnGarbage(free) {
    const lane = free[rnd(free.length)];
    game.obstacles.push({ type: 'garbage', lane, z: K.ZFAR.garbage, anim: 0, hit: false, factor: 1.0, jumpable: true, half: 23, variant: rnd(4) });
  }
  function spawnMoto(free) {
    const lane = free[rnd(free.length)];                  // cualquier carril (antes era casi siempre el central)
    game.obstacles.push({ type: 'moto', lane, z: K.ZFAR.moto, anim: 0, hit: false, factor: 1.7, jumpable: false, half: 24 });
  }
  function pushZombie(lane, z, talk) {
    const o = { type: 'zombie', lane, z, anim: Math.random() * 6, hit: false, factor: 1.18, jumpable: false, half: 12, talk: !!talk, mutant: false };
    game.obstacles.push(o); return o;
  }
  // Grupo de 1–3 zombies que ocupa 1–2 carriles (deja siempre ≥1 libre).
  // Pasado cierto tiempo el de adelante puede ser MUTANTE: lanza un
  // escupitajo tóxico (ataque especial) al carril del jugador (saltable o
  // esquivable, ~0.8s de reacción fija).
  function spawnZombieGroup(free) {
    const canTwo = free.length >= 3;                      // ocupar 2 carriles solo si queda ≥1 libre
    const lanesCount = (canTwo && Math.random() < 0.5) ? 2 : 1;
    const pool = free.slice(), chosen = [];
    for (let i = 0; i < lanesCount; i++) chosen.push(pool.splice(rnd(pool.length), 1)[0]);
    let budget = lanesCount === 2 ? 2 + rnd(2) : 1 + rnd(3);   // 2–3 o 1–3 zombies
    const depth = {}; chosen.forEach(l => (depth[l] = 0));
    let li = 0, front = null;
    while (budget > 0) {
      const lane = chosen[li % lanesCount];
      const z = pushZombie(lane, K.ZFAR.zombie + depth[lane] * 0.7, front === null);  // un solo globo por grupo
      if (front === null) front = z;
      depth[lane]++; budget--; li++;
    }
    const chance = clamp((game.t - 40) / 120, 0, 0.6);
    if (game.t > 40 && Math.random() < chance) {
      front.mutant = true; front.talk = false; front.half = 16; front.factor = 1.0;
      game.obstacles.push({ type: 'spit', lane: game.player.lane, z: 9, anim: 0, hit: false, factor: 1, jumpable: true, half: 13, spit: true, spitSpeed: 11 });
      Audio.sfx.bad();
    }
  }
  function spawnObstacle() {
    const free = [0, 1, 2].filter(l => !laneOccupied(l));
    if (free.length < 2) return;                          // siempre ≥1 carril libre
    const r = Math.random();
    if (r < 0.34) spawnGarbage(free);
    else if (r < 0.70) spawnZombieGroup(free);
    else spawnMoto(free);
  }

  // Monedas en patrones (línea / zigzag tejido / arco para saltar)
  function spawnCoins() {
    const baseZ = K.ZFAR.coin, kind = Math.random();
    const add = (lane, z, h) => game.coinsArr.push({ lane, z, h, spin: Math.random() * 6, got: false, passed: false });
    if (kind < 0.32) {                                     // línea baja
      const lane = rnd(3), n = 4 + rnd(3);
      for (let i = 0; i < n; i++) add(lane, baseZ + i * 0.55, 0);
    } else if (kind < 0.56) {                              // zigzag: te hace tejer entre carriles
      let lane = rnd(3), dir = lane === 2 ? -1 : 1; const n = 6 + rnd(4);
      for (let i = 0; i < n; i++) {
        add(lane, baseZ + i * 0.6, 0);
        if (lane + dir < 0 || lane + dir > 2) dir = -dir;
        if (i % 2 === 1) lane += dir;
      }
    } else if (kind < 0.76) {                              // arco para saltar
      const lane = rnd(3), n = 5 + rnd(2);
      for (let i = 0; i < n; i++) add(lane, baseZ + i * 0.5, Math.sin((i / (n - 1)) * Math.PI) * 74);
    } else {                                               // fila alta: salto obligado
      const lane = rnd(3), n = 4 + rnd(3);
      for (let i = 0; i < n; i++) add(lane, baseZ + i * 0.5, 60 + Math.sin((i / (n - 1)) * Math.PI) * 12);
    }
    game.coinT = 0.55 + Math.random() * 0.8;
  }

  function spawnPowerup() {
    game.powerups.push({ lane: rnd(3), z: K.ZFAR.power, phase: Math.random() * 6, got: false, passed: false });
    game.powerT = 10 + Math.random() * 7;
  }
  function applyPowerup() {
    const fx = game.fx, r = rnd(4);
    if (r === 0)      { fx.mult = 1.5; fx.sTimer = 5; fx.sLabel = 'TURBO'; fx.sGood = true;  banner('TURBO · +VELOCIDAD', BONE); Audio.sfx.good(); }
    else if (r === 1) { game.player.shield = true; banner('ESCUDO ACTIVO', BONE); Audio.sfx.good(); }
    else if (r === 2) { fx.mult = 0.6; fx.sTimer = 5; fx.sLabel = 'LENTO'; fx.sGood = false; banner('LENTO · -VELOCIDAD', RED); Audio.sfx.bad(); }
    else              { fx.rainTimer = 5; banner('LLUVIA DE OBSTÁCULOS', RED); Audio.sfx.bad(); }
  }
  function spawnInterval() {
    let iv = Math.max(0.6, 1.3 * Math.pow(0.9, Math.floor(game.t / 18)));
    if (game.fx.rainTimer > 0) iv = Math.max(0.4, iv * 0.45);
    return iv;
  }

  // ── Update ────────────────────────────────────────────────────
  function update(dt) {
    const g = game, p = g.player, fx = g.fx;
    g.t += dt;
    g.speed = Math.min(K.CAP_Z, K.BASE_Z + g.t * K.SPEED_RAMP);   // sube rápido y parejo
    if (fx.sTimer > 0) { fx.sTimer -= dt; if (fx.sTimer <= 0) { fx.mult = 1; fx.sLabel = null; } }
    if (fx.rainTimer > 0) fx.rainTimer -= dt;
    const eff = g.speed * Math.min(K.MULT_MAX, fx.mult);

    g.dist += eff * dt; g.scroll += eff * dt;

    // jugador (la cámara se centra en su carril)
    p.px += (p.lane - 1 - p.px) * Math.min(1, dt * 17);
    g.cam = p.px;
    if (p.jumping) { p.jumpOff += p.jumpVel * dt; p.jumpVel -= K.GRAV * dt; if (p.jumpOff <= 0) { p.jumpOff = 0; p.jumping = false; p.jumpVel = 0; } }
    if (p.hopT > 0) p.hopT -= dt;
    p.run += dt * 14;
    if (p.invuln > 0) p.invuln -= dt;
    if (g.shake > 0) g.shake -= dt;
    if (g.coinFlash > 0) g.coinFlash -= dt * 4;

    // spawns
    g.spawnT -= dt; if (g.spawnT <= 0) { spawnObstacle(); g.spawnT = spawnInterval(); }
    g.coinT -= dt;  if (g.coinT <= 0) spawnCoins();
    g.powerT -= dt; if (g.powerT <= 0) spawnPowerup();

    // mover en z
    for (const o of g.obstacles) { o.z -= (o.spit ? o.spitSpeed : eff * o.factor) * dt; o.anim += dt * (o.type === 'moto' ? 22 : o.type === 'spit' ? 14 : 6); }
    for (const c of g.coinsArr) { c.z -= eff * dt; c.spin += dt * 9; }
    for (const u of g.powerups) { u.z -= eff * dt; u.phase += dt * 3.4; }
    for (const pt of g.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 760 * dt; pt.life -= dt; }
    for (const pk of g.pops) { pk.y -= 40 * dt; pk.life -= dt; }

    // ── colisiones (por cruce de plano: nada "tunelea" a alta velocidad) ──
    for (const o of g.obstacles) {
      if (o.hit || o.z > K.HIT_Z) continue;
      o.hit = true;
      if (o.lane !== p.lane) continue;
      if (o.jumpable && p.jumpOff > 30) continue;          // saltó la basura
      if (p.invuln > 0) continue;
      if (p.shield) { p.shield = false; p.invuln = 1.0; g.shake = 0.25; o.z = -1; burst(K.PLAYER_X, groundY(K.PLAYER_Z) - 70, BONE, 14); banner('¡ESCUDO ROTO!', BONE); Audio.sfx.hit(); }
      else { endGame(); return; }
    }
    // Recolección por VENTANA: mientras la moneda está en [REMOVE_Z, COLLECT_Z]
    // se chequea cada frame; se toma apenas el carril+salto coinciden. Así el
    // jugador tiene toda la ventana para alinearse (antes se evaluaba una sola
    // vez en un plano lejano y "algunas se guardaban y otras no").
    for (const c of g.coinsArr) {
      if (c.got || c.z > K.COLLECT_Z) continue;
      if (c.lane === p.lane && p.jumpOff >= Math.min(c.h - 28, 42)) {   // salto tolerante (no hace falta el pico)
        c.got = true; g.coins++; g.coinFlash = 1;
        const cx = sx(c.lane - 1, c.z, g.cam), cy = groundY(c.z) - (28 + c.h) * pp(c.z);
        burst(cx, cy, RED, 6); pop(cx, cy - 6, '+1', BONE); Audio.sfx.coin();
      }
    }
    for (const u of g.powerups) {
      if (u.got || u.z > K.COLLECT_Z) continue;
      if (u.lane === p.lane) { u.got = true; burst(sx(u.lane - 1, u.z, g.cam), groundY(u.z) - 46 * pp(u.z), BONE, 12); applyPowerup(); }
    }

    // limpieza
    g.obstacles = g.obstacles.filter(o => o.z > K.REMOVE_Z);
    g.coinsArr = g.coinsArr.filter(c => !c.got && c.z > K.REMOVE_Z);
    g.powerups = g.powerups.filter(u => !u.got && u.z > K.REMOVE_Z);
    g.particles = g.particles.filter(pt => pt.life > 0);
    g.pops = g.pops.filter(pk => pk.life > 0);
    if (g.banner) { g.banner.t -= dt; if (g.banner.t <= 0) g.banner = null; }
  }

  // ── Render ────────────────────────────────────────────────────
  function speedFactor() { return clamp((game.speed - K.BASE_Z) / (K.CAP_Z - K.BASE_Z), 0, 1) * Math.min(1.4, game.fx.mult); }

  function drawSpeedLines(ctx, sf) {
    if (sf <= 0.08) return;
    const n = 11, cx = W / 2, cy = HORIZON + (H - HORIZON) * 0.55, r0 = 130, r1 = 280 + sf * 280;
    ctx.strokeStyle = RED; ctx.lineCap = 'round'; ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + game.t * 0.25;
      ctx.globalAlpha = 0.04 + sf * 0.16;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.6);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Halo verde detrás de la basura (blending aditivo → "prende" sobre el negro)
  function drawSmokeGlow(ctx, cx, gy, s, phase) {
    const pulse = 1 + Math.sin(phase * 3) * 0.08;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#1f8a36'; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.ellipse(cx, gy - 16 * s, 36 * s * pulse, 32 * s * pulse, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#37d85a'; ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.ellipse(cx, gy - 16 * s, 21 * s, 18 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  // Bocanadas de humo verde neón que suben (aditivo, bien visibles)
  function drawSmoke(ctx, cx, baseY, s, phase) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const t = ((phase * 0.5) + i * 0.6) % 3, rise = t / 3;
      const x = cx + Math.sin(phase * 1.1 + i * 1.7) * 14 * s, y = baseY - (4 + rise * 56) * s, r = (8 + rise * 13) * s, a = 1 - rise;
      ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#2fbf52';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a * 0.7; ctx.fillStyle = '#9bff7a';
      ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  function drawMutantGlow(ctx, cx, cy, s, phase) {
    const r = (22 + Math.sin(phase * 3) * 5) * s;
    ctx.globalAlpha = 0.20 + 0.12 * (Math.sin(phase * 3) * 0.5 + 0.5);
    ctx.fillStyle = '#39ff6a';
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 1.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawSpit(ctx, o, cam) {
    for (let i = 3; i >= 1; i--) {                        // estela
      const zz = o.z + i * 0.5, sp = pp(zz);
      ctx.globalAlpha = 0.1 * i; ctx.fillStyle = '#39ff6a';
      ctx.beginPath(); ctx.arc(sx(o.lane - 1, zz, cam), groundY(zz) - 16 * sp, 11 * sp, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const sp = pp(o.z), cx = sx(o.lane - 1, o.z, cam), cy = groundY(o.z) - 16 * sp;   // bajo, a ras del piso (saltable)
    billboard(cx, cy, sp * K.OBJ_SCALE * 1.15, () => S.spitB(o.anim));
  }

  function render() {
    const ctx = CR.ctx, g = game;
    const playing = state === 'playing';
    const sf = playing ? speedFactor() : 0;
    const shx = g.shake > 0 ? (Math.random() - 0.5) * 9 : 0, shy = g.shake > 0 ? (Math.random() - 0.5) * 9 : 0;
    const bob = playing ? Math.sin(g.t * 9) * (1.1 + sf * 2.4) : 0;
    ctx.save(); ctx.translate(shx, shy + bob);

    BG.drawSky(ctx, g.cam);
    BG.drawFloor(ctx, g.cam, g.scroll);
    if (playing) drawSpeedLines(ctx, sf);

    // ordenar por z (lejos → cerca)
    const items = [];
    for (const o of g.obstacles) items.push({ z: o.z, k: 'o', o });
    for (const c of g.coinsArr) items.push({ z: c.z, k: 'c', c });
    for (const u of g.powerups) items.push({ z: u.z, k: 'u', u });
    if (state !== 'start') items.push({ z: K.PLAYER_Z, k: 'h' });
    items.sort((a, b) => b.z - a.z);

    for (const it of items) {
      if (it.k === 'h') { drawHero(); continue; }
      if (it.k === 'o') {
        const o = it.o, s = pp(o.z) * K.OBJ_SCALE, cx = sx(o.lane - 1, o.z, g.cam), gy = groundY(o.z);
        const bs = clamp(s, 1.0, 1.7);                    // escala del globo (fija/legible)
        if (o.type === 'garbage') {
          const sg = s * 1.4;                             // más grande para contrastar con el piso
          shadow(cx, gy, o.half * sg, 0.34);
          drawSmokeGlow(ctx, cx, gy, sg, o.anim);         // halo verde DETRÁS
          billboard(cx, gy, sg, () => S.garbageB(o.variant));
          drawSmoke(ctx, cx, gy - 4 * sg, sg, o.anim);    // bocanadas verdes ARRIBA
        } else if (o.type === 'spit') {
          drawSpit(ctx, o, g.cam);
        } else if (o.type === 'zombie') {
          shadow(cx, gy, o.half * s, 0.3);
          if (o.mutant) { drawMutantGlow(ctx, cx, gy - 58 * s, s, o.anim); billboard(cx, gy, s, () => S.mutantB(o.anim)); }
          else { billboard(cx, gy, s, () => S.zombieB(o.anim)); if (o.talk && s > 0.32) S.speechBubble(cx, gy - 62 * s, bs, ['SHOES...']); }
        } else {
          shadow(cx, gy, o.half * s, 0.3);
          billboard(cx, gy, s, S.motoB); if (s > 0.32) S.speechBubble(cx, gy - 82 * s, bs, ['dame las', 'zapas mano']);
        }
      } else if (it.k === 'c') {
        const c = it.c, s = pp(c.z) * K.OBJ_SCALE, cx = sx(c.lane - 1, c.z, g.cam), cy = groundY(c.z) - (28 + c.h) * pp(c.z);
        billboard(cx, cy, s, () => S.coinB(c.spin));
      } else {
        const u = it.u, s = pp(u.z) * K.OBJ_SCALE, cx = sx(u.lane - 1, u.z, g.cam), cy = groundY(u.z) - (46 + Math.sin(u.phase) * 6) * pp(u.z);
        ctx.fillStyle = 'rgba(232,224,208,' + (0.14 + 0.1 * (Math.sin(u.phase * 2) * 0.5 + 0.5)) + ')';
        ctx.beginPath(); ctx.ellipse(cx, cy, 30 * s, 26 * s, 0, 0, Math.PI * 2); ctx.fill();
        billboard(cx, cy, s, S.powerB);
      }
    }

    for (const pt of g.particles) { ctx.globalAlpha = Math.max(0, pt.life * 2); R(pt.x, pt.y, pt.s, pt.s, pt.color); }
    ctx.globalAlpha = 1;
    for (const pk of g.pops) { ctx.globalAlpha = Math.min(1, pk.life * 1.4); pf(pk.text, pk.x, pk.y, 12, pk.color, 'center'); }
    ctx.globalAlpha = 1;

    ctx.restore();

    if (!vignette) {
      vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.9);
      vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.58)');
    }
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);

    if (playing) drawHUD();
  }

  function drawHero() {
    const ctx = CR.ctx, g = game, p = g.player, s = pp(K.PLAYER_Z) * K.PLAYER_SCALE;
    const lean = (p.lane - 1 - p.px) * 36;
    const hop = p.hopT > 0 ? Math.sin((1 - p.hopT / 0.18) * Math.PI) * 7 : 0;
    const cx = K.PLAYER_X + lean, gy0 = groundY(K.PLAYER_Z), gy = gy0 - p.jumpOff * pp(K.PLAYER_Z) - hop;
    shadow(K.PLAYER_X + lean * 0.6, gy0, 26 * s * (1 - p.jumpOff * 0.004), Math.max(0, 0.36 - p.jumpOff * 0.002));
    if (p.shield) {
      ctx.strokeStyle = 'rgba(232,224,208,' + (0.45 + 0.3 * Math.sin(g.t * 8)) + ')';
      ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(cx, gy - 70 * s, 52 * s, 86 * s, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const blink = p.invuln > 0 && Math.floor(g.t * 16) % 2 === 0;
    billboard(cx, gy, s, () => S.chadBack(p.run, p.jumping, blink ? 0.4 : 1));
  }

  function drawHUD() {
    const g = game, metros = Math.floor(g.dist * K.METERS);
    const sz = 26 + g.coinFlash * 10;
    pf('' + g.coins, W - 16, 14, sz, BONE, 'right');     // PUNTAJE = monedas
    pf('MONEDAS', W - 16, 48, 9, RED, 'right');
    pf(metros + ' m', W - 16, 62, 8, MUTED, 'right');    // distancia (ranking mensual)
    let y = 14;
    if (g.player.shield) { pf('◈ ESCUDO', 16, y, 11, BONE); y += 22; }
    if (g.fx.sTimer > 0) { pf((g.fx.sGood ? '▲ ' : '▼ ') + g.fx.sLabel, 16, y, 11, g.fx.sGood ? BONE : REDM); y += 22; }
    if (g.fx.rainTimer > 0) { pf('☂ LLUVIA', 16, y, 11, REDM); }
    if (g.banner && g.banner.t > 0) { CR.ctx.globalAlpha = Math.min(1, g.banner.t); pf(g.banner.text, W / 2, 66, 14, g.banner.color, 'center'); CR.ctx.globalAlpha = 1; }
  }

  // ── Bucle por frame ───────────────────────────────────────────
  function tick(dt) {
    if (state === 'playing') update(dt);
    else { game.scroll += 2.4 * dt; game.cam = Math.sin(performance.now() / 2600) * 0.15; }
  }

  // ── Flujo de pantallas ────────────────────────────────────────
  function start() {
    Audio.resume();
    game = newGame(); state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('overScreen').classList.add('hidden');
  }
  // Integrado: al morir se guarda automáticamente con la cuenta Google.
  function endGame() {
    state = 'over'; game.shake = 0.3; Audio.sfx.hit();
    game.finalMetros = Math.floor(game.dist * K.METERS);
    game.finalCoins = game.coins; game.saved = true;
    document.getElementById('goTotal').textContent = game.finalCoins;
    document.getElementById('goDist').textContent = game.finalMetros;
    const st = document.getElementById('saveStatus');
    if (st) st.textContent = 'Guardando...';
    if (Board.save) {
      Board.save(game.finalCoins, game.finalMetros).then((r) => {
        if (st) st.textContent = r ? `✓ +${game.finalCoins} monedas a tu cuenta` : 'No se pudo guardar (revisá tu sesión)';
      });
    }
    Board.render();
    document.getElementById('overScreen').classList.remove('hidden');
  }

  CR.Game = { newGame, tick, render, start, moveLane, jump, getState: () => state, init() { game = newGame(); } };
})(window.CR);
