-- ════════════════════════════════════════════════════════════════
--  CHUNKY SNKRS — items canjeables de la ruleta + límites de giros
--  Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════

-- ── Items canjeables ganados en la ruleta (máx 5 disponibles/usuario) ──
create table if not exists public.items_usuario (
  id           bigint generated always as identity primary key,
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  tipo_item    text not null,                 -- 'envio_gratis' | 'chunky_bag' | 'llavero_chunky'
  estado       text not null default 'disponible',  -- 'disponible' | 'canjeado'
  obtenido_en  timestamptz not null default now(),
  canjeado_en  timestamptz
);
create index if not exists idx_items_usuario on public.items_usuario (usuario_id, estado);
alter table public.items_usuario enable row level security;

-- ── Contador de giros semanales por usuario ─────────────────────
alter table public.usuarios
  add column if not exists giros_semana     integer not null default 0,
  add column if not exists giros_semana_ref text;

-- ── Ranking por metros (índice para ordenar/contar rápido) ──────
alter table public.puntajes_mensuales
  add column if not exists metros integer not null default 0;
create index if not exists idx_puntajes_metros on public.puntajes_mensuales (creado_en, metros desc);
