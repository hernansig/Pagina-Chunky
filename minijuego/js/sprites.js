/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER — sprites pixel art (coords locales, pies en y=0,
   centrado en x=0). Se dibujan vía CR.billboard con escala según z.
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';
  const R = CR.R, pf = CR.pf;

  // Chad — estética urbana Y2K / dosmilera (visto de espaldas)
  function chadBack(phase, jumping, alpha) {
    const JER = '#ece5d6', RED = '#cc0000', RED2 = '#8b0000', NAVY = '#161616',
          JEAN = '#2c2c30', JEAN2 = '#1d1d20', JEAN3 = '#3a3a40',
          SHOE = '#f1ece0', SHOE2 = '#cbc4b2', SKIN = '#caa07a', HAIR = '#15110d',
          CAP = '#cc0000', HP = '#d8d8e0';
    if (alpha != null) CR.ctx.globalAlpha = alpha;
    const st = jumping ? 0 : Math.sin(phase) * 5, tuck = jumping ? 7 : 0;
    const lL = Math.max(0, st) + tuck, lR = Math.max(0, -st) + tuck;

    // zapatillas "dad"/chunky blancas
    R(-25, -15 - lL, 24, 15, SHOE); R(-25, -7 - lL, 24, 7, SHOE2); R(-25, -15 - lL, 24, 3, '#ffffff');
    R(1, -15 - lR, 24, 15, SHOE);   R(1, -7 - lR, 24, 7, SHOE2);   R(1, -15 - lR, 24, 3, '#ffffff');
    R(-20, -11 - lL, 9, 3, RED);    R(8, -11 - lR, 9, 3, RED);

    // jeans baggy claros y anchos
    R(-25, -46, 23, 34, JEAN); R(2, -46, 23, 34, JEAN);
    R(-27, -25, 6, 13, JEAN2); R(21, -25, 6, 13, JEAN2);    // campana en los tobillos
    R(-14, -46, 2, 34, JEAN3); R(12, -46, 2, 34, JEAN3);    // costuras
    R(-26, -50, 52, 6, JEAN2); R(-3, -50, 6, 4, '#caa56a'); // cintura + hebilla (saggy)

    // jersey oversized
    R(-30, -80, 60, 36, JER);
    R(-30, -80, 60, 4, RED); R(-30, -48, 60, 4, RED);       // vivos
    R(-30, -78, 4, 32, RED2); R(26, -78, 4, 32, RED2);      // franjas laterales
    R(-13, -74, 9, 16, NAVY); R(4, -74, 9, 16, NAVY);       // número "00" en la espalda
    R(-11, -72, 5, 4, JER); R(6, -72, 5, 4, JER); R(-11, -64, 5, 4, JER); R(6, -64, 5, 4, JER);

    // brazos (mangas baggy + antebrazo + muñequera)
    const aS = jumping ? -9 : Math.sin(phase) * 7;
    R(-37, -78 + aS, 12, 24, JER);  R(25, -78 - aS, 12, 24, JER);
    R(-36, -55 + aS, 10, 13, SKIN); R(26, -55 - aS, 10, 13, SKIN);
    R(-36, -44 + aS, 10, 5, '#ffffff'); R(26, -44 - aS, 10, 5, '#ffffff');

    // cuello / cabeza
    R(-7, -86, 14, 8, SKIN);
    R(-9, -100, 18, 16, SKIN);
    R(-9, -100, 18, 5, HAIR);
    // gorra al revés (snapback)
    R(-11, -104, 22, 9, CAP); R(-11, -97, 22, 4, RED2);
    R(-3, -96, 6, 4, '#ffffff'); R(-1, -95, 2, 3, RED2);    // cierre del snapback
    // auriculares 2000s
    R(-14, -100, 4, 13, HP); R(10, -100, 4, 13, HP);
    R(-13, -107, 26, 4, '#bfbfca');

    CR.ctx.globalAlpha = 1;
  }

  // Basura con 4 variantes (v = 0..3)
  function garbageB(v) {
    if (v === 1) {                 // pila de cajas de cartón
      R(-21, -18, 22, 18, '#5a4632'); R(-21, -18, 22, 3, '#6f5740'); R(-11, -18, 2, 18, '#3e3022');
      R(-2, -30, 20, 16, '#6a5238'); R(-2, -30, 20, 3, '#7d6346'); R(6, -30, 2, 16, '#4a3a28');
      R(2, -26, 12, 2, '#3a2c1c');  // cinta
    } else if (v === 2) {          // tacho metálico volcado
      R(-22, -16, 30, 16, '#3a3a3a'); R(-22, -16, 30, 3, '#4a4a4a'); R(-24, -16, 4, 16, '#2a2a2a');
      R(-18, -12, 22, 1, '#565656'); R(-18, -8, 22, 1, '#565656');
      R(8, -14, 9, 12, '#2a2a2a');  // tapa al lado
      R(-12, -20, 6, 5, '#1c1c1c'); R(-3, -22, 5, 6, '#262626');  // basura saliendo
    } else if (v === 3) {          // neumático + escombros/ladrillos
      R(-18, -18, 20, 18, '#0e0e0e'); R(-14, -14, 12, 10, '#222222');
      R(4, -12, 15, 12, '#5a2a22'); R(4, -12, 15, 3, '#6a352a'); R(11, -12, 1, 12, '#3a1a16');
      R(-3, -8, 6, 6, '#444444');
    } else {                       // bolsas de basura
      R(-21, -20, 18, 20, '#2c2c2c'); R(-4, -16, 24, 16, '#383838'); R(-10, -27, 13, 13, '#222222');
      R(-4, -16, 24, 2, '#4a4a4a');  // brillo superior
      R(-16, -8, 5, 5, '#8b0000'); R(11, -9, 5, 7, '#6a6a6a'); R(0, -29, 4, 5, '#7a6a52');
    }
  }

  // Zombie azul/morado con ojos pálidos brillantes
  function zombieB(phase) {
    const sh = Math.sin(phase) * 2;
    const RAG = '#2a2348', RAG2 = '#1d1836', ARM = '#3a3360', SK = '#7a6aa8', EYE = '#9be0ff', MOUTH = '#241a3a';
    R(-9, -14, 7, 14 + sh, RAG2); R(2, -14, 7, 14 - sh, RAG2);
    R(-10, -46, 20, 32, RAG);
    R(-16, -42, 7, 18, ARM); R(9, -42, 7, 18, ARM);               // brazos al frente
    R(-8, -62, 16, 16, SK);                                       // cabeza
    R(-8, -62, 16, 4, '#6a5a98');
    R(-4, -57, 3, 3, EYE); R(3, -57, 3, 3, EYE);                  // ojos brillantes
    R(-5, -50, 9, 2, MOUTH);
  }

  // Zombie MUTANTE: más grande, verde tóxico + morado, ojos lima
  function mutantB(phase) {
    const sh = Math.sin(phase) * 2;
    const SK = '#6fae3f', SK2 = '#4f8a2c', RAG = '#3a2a55', RAG2 = '#281c40', EYE = '#c8ff5a', TOOTH = '#d8d8c8';
    R(-12, -18, 9, 18 + sh, RAG2); R(3, -18, 9, 18 - sh, RAG2);   // piernas
    R(-15, -56, 30, 40, RAG); R(-15, -56, 30, 5, SK2);            // torso grande
    R(-6, -44, 12, 12, RAG2);
    R(-25, -54, 11, 30, SK); R(-28, -26, 11, 9, SK);              // brazo mutante enorme (izq)
    R(14, -48, 9, 22, SK2); R(21, -30, 8, 8, SK);                 // brazo der
    R(-12, -74, 24, 22, SK); R(-12, -74, 24, 5, SK2);             // cabeza grande
    R(-17, -62, 6, 6, SK2); R(12, -64, 6, 6, SK2);                // protuberancias
    R(-7, -66, 6, 5, EYE); R(3, -66, 6, 5, EYE);                  // ojos brillantes
    R(-8, -58, 16, 5, '#16240e');                                 // boca
    R(-6, -58, 2, 3, TOOTH); R(-1, -58, 2, 3, TOOTH); R(4, -58, 2, 3, TOOTH);
  }

  // Escupitajo tóxico (proyectil del mutante), centrado en el origen
  function spitB(phase) {
    const w = Math.sin(phase * 3) * 1.5;
    R(-9, -8 + w, 18, 16, '#39ff6a');
    R(-7, -10, 14, 20, '#39ff6a');
    R(-5, -6, 8, 8, '#bfffb0');                                   // brillo
    R(-12, -2, 4, 4, '#2bd152'); R(8, -2, 4, 4, '#2bd152');       // gotas
    R(-2, 7, 4, 5, '#39ff6a');                                    // goteo
  }

  // Motochorro ñeri (de frente, viene hacia vos) sobre moto detallada
  function motoB() {
    const TIRE = '#0c0c0c', RIM = '#2a2a2a', BODY = '#1b1b1b', BODY2 = '#262626', RED = '#cc0000',
          CHR = '#9a9a9a', LIGHT = '#f0e9d8', SKIN = '#b9966e', HOOD = '#181818', HOOD2 = '#0f0f0f', SHADE = '#080808';
    // rueda delantera (de frente) con cubierta y rayos
    R(-12, -30, 24, 30, TIRE); R(-12, -30, 24, 3, '#000'); R(-12, -3, 24, 3, '#000');
    R(-8, -26, 16, 22, RIM); R(-2, -20, 4, 12, '#3a3a44');       // llanta + cubo
    R(-14, -34, 28, 6, BODY2);                                   // guardabarros
    // chasis / tanque
    R(-16, -46, 32, 14, BODY); R(-16, -46, 32, 3, RED);
    // manubrio + espejos
    R(-27, -50, 54, 4, BODY2);
    R(-29, -57, 5, 8, CHR); R(24, -57, 5, 8, CHR);               // espejos
    R(-27, -50, 4, 7, BODY2); R(23, -50, 4, 7, BODY2);
    // faro encendido + guiños
    R(-7, -40, 14, 9, LIGHT); R(-4, -38, 8, 5, '#ffffff');
    R(-20, -44, 4, 4, '#cc0000'); R(16, -44, 4, 4, '#cc0000');
    R(13, -16, 11, 5, CHR);                                      // escape

    // ── el ñeri ──
    R(-11, -66, 22, 22, HOOD);                                   // torso con buzo
    R(-6, -64, 12, 2, '#8b0000');                                // cadenita
    R(-12, -82, 24, 11, HOOD2);                                  // capucha
    R(-12, -83, 24, 5, HOOD);
    R(-9, -78, 18, 12, SKIN);                                    // cara
    R(-8, -75, 16, 4, SHADE); R(-7, -75, 6, 4, '#141414'); R(1, -75, 6, 4, '#141414'); // lentes oscuros
    R(-4, -69, 8, 2, '#5a3a3a');                                 // mueca
    // brazos: uno extendido al manubrio (gesto de manotazo)
    R(-25, -64, 13, 7, HOOD); R(-28, -60, 8, 7, SKIN);
    R(13, -58, 12, 6, HOOD);  R(23, -56, 7, 6, SKIN);
  }

  // Ficha/token de la marca: disco hueso con borde y marca roja (resalta en negro)
  function coinB(spin) {
    const ww = 2 + Math.abs(Math.cos(spin)) * 8;
    R(-ww, -9, ww * 2, 18, '#e8e0d0');                 // disco hueso
    R(-ww + 1, -7, 2, 14, '#f6f1e6');                  // brillo
    R(-ww, -9, ww * 2, 2, '#cc0000'); R(-ww, 7, ww * 2, 2, '#cc0000');  // borde rojo
    if (ww > 3) R(-Math.min(2, ww - 1), -5, Math.min(4, (ww - 1) * 2), 10, '#cc0000');  // marca central
  }

  function powerB() {
    R(-14, 0, 28, 8, '#e8e0d0'); R(-12, -9, 22, 10, '#cc2222'); R(-10, -7, 10, 5, '#e8e0d0'); R(4, -8, 5, 5, '#1a1a1a');
  }

  // Bocadillo de diálogo (espacio de pantalla, tamaño fijo legible).
  // s viene "clampeado" desde el render así el texto NO se achica con la
  // distancia ni a alta velocidad. Borde rojo para resaltar en negro.
  function speechBubble(cx, by, s, lines) {
    const size = 8 * s, lh = 11 * s, pad = 8 * s;
    let maxch = 0; for (const l of lines) maxch = Math.max(maxch, l.length);
    const bw = Math.max(58 * s, maxch * size * 0.92 + pad * 2), bh = lines.length * lh + pad;
    const bx = cx - bw / 2, top = by - bh;
    R(bx - 1, top - 1, bw + 2, bh + 2, '#cc0000');                 // borde rojo
    R(bx, top, bw, bh, '#f6f2e8');                                 // fondo hueso claro
    R(bx + bw * 0.42, by, 9 * s, 9 * s, '#f6f2e8');                // colita
    R(bx + bw * 0.42, by, 9 * s, 2, '#cc0000');
    lines.forEach((l, i) => pf(l, cx, top + pad * 0.5 + i * lh, size, '#101010', 'center'));
  }

  CR.Sprites = { chadBack, garbageB, zombieB, mutantB, spitB, motoB, coinB, powerB, speechBubble };
})(window.CR);
