/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER (integrado) — guarda METROS (ranking) + banca monedas,
   vía backend con la sesión Google. Ranking mensual por metros.
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';

  async function token() { return window.CHKAuth ? await window.CHKAuth.getToken() : null; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Token de sesión de la partida (anti-cheat): lo emite el backend al empezar
  // y se envía al guardar. Sin él, el puntaje no se guarda (server lo exige).
  // `startSession()` se dispara sin esperar (fire-and-forget) desde game.js,
  // así que si la partida termina MUY rápido (típico en celular: red más
  // lenta + controles táctiles con muertes tempranas) el fetch todavía puede
  // estar en vuelo. Guardamos la promesa en `pending` para que `save()` la
  // espere en vez de leer `sessionToken` a las apuradas y mandar null.
  let sessionToken = null;
  let pending = null;
  async function startSession() {
    sessionToken = null;
    pending = (async () => {
      try {
        const t = await token();
        if (!t) return null;
        // token de captcha (Turnstile), si la página lo tiene configurado
        const captcha = (window.CR && typeof CR.captchaToken === 'function') ? CR.captchaToken() : null;
        const res = await fetch('/api/app/iniciar-partida', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
          body: JSON.stringify({ captcha }),
        });
        const j = await res.json();
        if (j && j.ok) sessionToken = j.token;
        if (window.CR && typeof CR.captchaReset === 'function') CR.captchaReset();   // preparar el siguiente
        return sessionToken;
      } catch { return null; }
    })();
    return pending;
  }

  // metros = puntaje de ranking; monedas = monedas juntadas (se bancan al saldo).
  // Se manda SIEMPRE (aunque no haya token de sesión): las monedas se acreditan
  // igual; el token solo habilita que el puntaje entre al ranking.
  async function save(metros, monedas) {
    try {
      if (pending) { await pending; pending = null; }   // no leer sessionToken antes de tiempo
      const t = await token();
      if (!t) return null;
      const res = await fetch('/api/app/guardar-puntaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ metros, monedas, token: sessionToken || null }),
      });
      const j = await res.json();
      sessionToken = null;   // single-use: no reintentar con el mismo token
      if (window.CHKAuth && window.CHKAuth.me) window.CHKAuth.me(true).then(() => window.CHKAuth.mountHeader && window.CHKAuth.mountHeader());
      return j && j.ok ? j : null;
    } catch { return null; }
  }

  async function render() {
    const el = document.getElementById('boardList');
    if (!el) return;
    try {
      const t = await token();
      const headers = t ? { Authorization: 'Bearer ' + t } : {};
      const { top, tu } = await fetch('/api/app/ranking', { headers }).then(r => r.json());
      let html = (top && top.length)
        ? top.map((r) => `<li><span>${r.pos}º ${esc(r.alias)}</span><span>${Number(r.metros).toLocaleString('es-UY')} m</span></li>`).join('')
        : '<li class="empty">sin partidas este mes</li>';
      if (tu) html += `<li class="tu"><span>${tu.pos}º vos</span><span>${Number(tu.metros).toLocaleString('es-UY')} m</span></li>`;
      el.innerHTML = html;
    } catch {
      el.innerHTML = '<li class="empty">no se pudo cargar el ranking</li>';
    }
  }

  CR.Board = { save, render, startSession };
})(window.CR);
