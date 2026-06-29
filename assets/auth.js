/* ═══════════════════════════════════════════════════════════
   CHUNKY SNKRS — auth (Google vía Supabase) + saldo en header
   Supabase se usa SOLO para la sesión/token. Los datos del usuario
   y los puntos vienen del backend (/api/app). Expone window.CHKAuth.
   ═══════════════════════════════════════════════════════════ */
(function () {
  if (window.CHKAuth) return;                  // evitar doble carga

  const SB_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  let client = null, _usuario = null, _mePromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }

  async function api(action, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = await getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/api/app/' + action, {
      headers, ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || 'Error de red.');
    return data;
  }

  async function init() {
    try {
      const cfg = await fetch('/api/app/config').then((r) => r.json());
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
        await loadScript(SB_CDN);
      }
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (e) {
      console.warn('[auth] no se pudo inicializar Supabase:', e.message);
    }
  }

  async function getSession() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session || null;
  }
  async function getToken() {
    const s = await getSession();
    return s?.access_token || null;
  }

  async function signInWithGoogle() {
    if (!client) { alert('El login no está disponible en este momento.'); return; }
    await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/auth/callback' },
    });
  }
  async function signOut() {
    try { if (client) await client.auth.signOut(); } catch {}
    _usuario = null;
    location.href = '/';
  }

  // Devuelve la fila de `usuarios` (con puntos) o null si no hay sesión.
  // Cachea la PROMESA (no solo el resultado) para que llamadas concurrentes
  // esperen el mismo fetch y no devuelvan null antes de tiempo.
  async function me(force) {
    if (force) _mePromise = null;
    if (!_mePromise) {
      _mePromise = (async () => {
        const token = await getToken();
        if (!token) { _usuario = null; return null; }
        try { const { usuario } = await api('me'); _usuario = usuario; }
        catch { _usuario = null; }
        return _usuario;
      })();
    }
    return _mePromise;
  }

  // Para páginas protegidas (minijuego/jugar, ruleta). true si hay sesión.
  async function requireAuth(msg) {
    const token = await getToken();
    if (token) return true;
    const m = msg || 'Registrate con Google para jugar y acumular puntos';
    location.replace('/mi-perfil?msg=' + encodeURIComponent(m));
    return false;
  }

  // ── Slot del header (saldo / iniciar sesión) ──────────────────
  function mountHeader() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    let slot = nav.querySelector('.nav-auth');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'nav-auth';
      nav.appendChild(slot);
    }
    if (_usuario) {
      slot.innerHTML = `<a class="login-link" href="/mi-perfil">Mi perfil</a>`;
    } else {
      slot.innerHTML = `<a class="login-link" href="/mi-perfil">Iniciar sesión</a>`;
    }
  }

  async function bootHeader() {
    // esperar a que chrome.js haya inyectado el nav
    for (let i = 0; i < 40 && !document.querySelector('.nav'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await me();
    mountHeader();
  }

  window.CHKAuth = {
    ready: (async () => { await init(); return true; })(),
    getSession, getToken, signInWithGoogle, signOut, me, requireAuth, mountHeader,
    get client() { return client; },
    get usuario() { return _usuario; },
  };

  window.CHKAuth.ready.then(bootHeader);
})();
