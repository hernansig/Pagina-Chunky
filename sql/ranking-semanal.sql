-- ════════════════════════════════════════════════════════════════
--  CHUNKY SNKRS — normaliza `puntajes_mensuales` para el RANKING SEMANAL
--  Correr en Supabase → SQL Editor. Idempotente y seguro sobre esquemas
--  viejos (NO borra filas: sólo agrega columnas y afloja restricciones).
--
--  Por qué: el repo tiene dos definiciones en conflicto de esta tabla.
--    · db/schema.sql (vieja): jugador_id/mes NOT NULL + unique(jugador_id,mes)
--    · sql/usuarios.sql (nueva): usuario_id/alias/metros/creado_en
--  Si la DB quedó con la vieja, cada INSERT de partida falla por las NOT NULL
--  de jugador_id/mes → el ranking queda vacío. Esto lo arregla.
-- ════════════════════════════════════════════════════════════════

-- 1) Asegurar las columnas que usa el backend actual (api/app/[action].js).
alter table public.puntajes_mensuales
  add column if not exists usuario_id uuid references public.usuarios(id) on delete cascade,
  add column if not exists alias      text,
  add column if not exists puntaje    integer not null default 0,
  add column if not exists metros     integer not null default 0,
  add column if not exists creado_en  timestamptz not null default now();

-- 2) Aflojar las NOT NULL legadas (jugador_id / mes) que bloquean los inserts.
--    El ranking actual NO usa esas columnas; las dejamos nullables por si hay
--    datos históricos, en vez de borrarlas.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'puntajes_mensuales'
               and column_name = 'jugador_id') then
    alter table public.puntajes_mensuales alter column jugador_id drop not null;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'puntajes_mensuales'
               and column_name = 'mes') then
    alter table public.puntajes_mensuales alter column mes drop not null;
  end if;
end $$;

-- 3) Quitar el/los unique legados (p.ej. unique(jugador_id, mes)): el ranking es
--    por PARTIDA individual, un usuario puede tener varias filas por semana.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.puntajes_mensuales'::regclass and contype = 'u'
  loop
    execute format('alter table public.puntajes_mensuales drop constraint %I', c.conname);
  end loop;
end $$;

-- 4) Índice para top-10 y cálculo de posición rápidos dentro de la semana.
create index if not exists idx_puntajes_semana
  on public.puntajes_mensuales (creado_en, metros desc);

-- ── Verificación rápida (opcional): estructura resultante ──
-- select column_name, is_nullable, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'puntajes_mensuales'
--  order by ordinal_position;
