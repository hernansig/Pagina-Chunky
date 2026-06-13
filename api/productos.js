import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed } from '../lib/http.js';

// GET /api/productos — catálogo público (solo productos activos).
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'GET')) return;
  try {
    const { data, error } = await supa()
      .from('productos')
      .select('id,nombre,precio,foto_url,talle,stock_disponible,activo,orden')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    json(res, 200, { ok: true, productos: data || [] });
  } catch (err) {
    console.error('[productos]', err.message);
    fail(res, 500, 'No se pudo cargar el catálogo.');
  }
}
