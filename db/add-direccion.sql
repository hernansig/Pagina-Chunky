-- ═══════════════════════════════════════════════════════════════════
--  CHUNKY SNKRS — agregar dirección de envío a los pedidos
--  Corré esto UNA vez en Supabase → SQL Editor (si ya creaste la base
--  con el schema viejo que no tenía esta columna).
-- ═══════════════════════════════════════════════════════════════════

alter table pedidos add column if not exists direccion_envio jsonb;
