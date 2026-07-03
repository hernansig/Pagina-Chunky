-- ═══════════════════════════════════════════════════════════════════
--  MIGRACIÓN: variantes de producto (talle / color / otro) + stock propio
--  Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
--
--  · Un producto SIN variantes sigue funcionando igual que hasta ahora
--    (stock en productos.stock_disponible).
--  · Un producto CON variantes: cada variante tiene su stock; el webhook
--    descuenta de la variante comprada, no del producto general.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists producto_variantes (
  id                uuid primary key default gen_random_uuid(),
  producto_id       uuid        not null references productos(id) on delete cascade,
  atributo          text        not null default 'talle',   -- 'talle' | 'color' | lo que quieras
  valor             text        not null,                   -- ej: '42', 'Rojo', 'M'
  stock_disponible  integer     not null default 0 check (stock_disponible >= 0),
  orden             integer     not null default 0,
  activo            boolean     not null default true,
  created_at        timestamptz not null default now(),
  unique (producto_id, atributo, valor)
);
create index if not exists idx_variantes_producto on producto_variantes (producto_id, activo, orden);

-- Igual que el resto de las tablas: RLS sin políticas públicas
-- (todo pasa por las Vercel Functions con la service_role key).
alter table producto_variantes enable row level security;

-- Descuento atómico de stock de una variante (misma idea que descontar_stock).
create or replace function descontar_stock_variante(p_variante_id uuid, p_cantidad integer)
returns void language plpgsql as $$
begin
  update producto_variantes
     set stock_disponible = greatest(stock_disponible - p_cantidad, 0)
   where id = p_variante_id;
end;
$$;
