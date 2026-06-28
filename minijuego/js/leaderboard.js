/* ════════════════════════════════════════════════════════════════
   CHUNKY RUNNER (integrado) — guarda el puntaje en Supabase vía backend
   usando la sesión de Google. El ranking es el TOP 10 semanal real.
   ════════════════════════════════════════════════════════════════ */
(function (CR) {
  'use strict';

  async function token() { return window.CHKAuth ? await window.CHKAuth.getToken() : null; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // puntaje = monedas recogidas; metros = distancia (ranking aparte).
  async function save(puntaje, metros) {
    try {
      const t = await token();
      if (!t) return null;
      const res = await fetch('/api/app/guardar-puntaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ puntaje, metros }),
      });
      const j = await res.json();
      // refrescar el saldo del header
      if (window.CHKAuth && window.CHKAuth.me) window.CHKAuth.me(true).then(() => window.CHKAuth.mountHeader && window.CHKAuth.mountHeader());
      return j && j.ok ? j : null;
    } catch { return null; }
  }

  async function render() {
    const el = document.getElementById('boardList');
    if (!el) return;
    try {
      const { top } = await fetch('/api/app/ranking').then(r => r.json());
      el.innerHTML = (top && top.length)
        ? top.map(r => `<li><span>${r.pos}. ${esc(r.alias)}</span><span>${Number(r.puntaje).toLocaleString('es-UY')}</span></li>`).join('')
        : '<li class="empty">sin puntajes esta semana</li>';
    } catch {
      el.innerHTML = '<li class="empty">no se pudo cargar el ranking</li>';
    }
  }

  CR.Board = { save, render };
})(window.CR);
