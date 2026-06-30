/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER (integrado) — guarda METROS (ranking) + banca monedas,
   vía backend con la sesión Google. Ranking semanal por metros.
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';

  async function token() { return window.CHKAuth ? await window.CHKAuth.getToken() : null; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // metros = puntaje de ranking; monedas = monedas juntadas (se bancan al saldo).
  async function save(metros, monedas) {
    try {
      const t = await token();
      if (!t) return null;
      const res = await fetch('/api/app/guardar-puntaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ metros, monedas }),
      });
      const j = await res.json();
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
        : '<li class="empty">sin partidas esta semana</li>';
      if (tu) html += `<li class="tu"><span>${tu.pos}º vos</span><span>${Number(tu.metros).toLocaleString('es-UY')} m</span></li>`;
      el.innerHTML = html;
    } catch {
      el.innerHTML = '<li class="empty">no se pudo cargar el ranking</li>';
    }
  }

  CR.Board = { save, render };
})(window.CR);
