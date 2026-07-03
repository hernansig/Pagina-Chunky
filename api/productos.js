import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed } from '../lib/http.js';

// GET /api/productos — catálogo público (solo productos activos).
// Cada producto incluye sus variantes activas (talle/color/... con stock
// propio); si la tabla de variantes no existe todavía, sigue sin ellas.
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'GET')) return;
  try {
    const sb = supa();
    const { data, error } = await sb
      .from('productos')
      .select('id,nombre,precio,foto_url,talle,stock_disponible,activo,orden')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    const productos = data || [];

    if (productos.length) {
      const { data: vars, error: eV } = await sb
        .from('producto_variantes')
        .select('id,producto_id,atributo,valor,stock_disponible,orden')
        .eq('activo', true)
        .in('producto_id', productos.map((p) => p.id))
        .order('orden', { ascending: true });
      if (eV) console.warn('[productos] variantes:', eV.message);   // tabla ausente → catálogo igual funciona
      const porProducto = {};
      for (const v of vars || []) (porProducto[v.producto_id] = porProducto[v.producto_id] || []).push(v);
      for (const p of productos) p.variantes = porProducto[p.id] || [];
    }

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    json(res, 200, { ok: true, productos });
  } catch (err) {
    console.error('[productos]', err.message);
    fail(res, 500, 'No se pudo cargar el catálogo.');
  }
}
