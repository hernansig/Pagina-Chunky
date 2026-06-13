import { supa } from '../lib/supabase.js';
import { json, fail, methodNotAllowed } from '../lib/http.js';

// GET /api/resenas-aprobadas — reseñas aprobadas para mostrar en la landing.
export default async function handler(req, res) {
  if (methodNotAllowed(req, res, 'GET')) return;
  try {
    const { data, error } = await supa()
      .from('resenas')
      .select('cliente_nombre,texto,rating,created_at')
      .eq('estado', 'aprobada')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    json(res, 200, { ok: true, resenas: data || [] });
  } catch (err) {
    console.error('[resenas-aprobadas]', err.message);
    fail(res, 500, 'No se pudieron cargar las reseñas.');
  }
}
