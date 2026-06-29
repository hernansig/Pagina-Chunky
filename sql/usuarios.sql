-- ════════════════════════════════════════════════════════════════
--  CHUNKY SNKRS — usuarios, puntos, ranking y ruleta
--  Correr en Supabase → SQL Editor. Idempotente y a prueba de tablas
--  preexistentes: crea lo que falte y agrega columnas faltantes.
-- ════════════════════════════════════════════════════════════════

-- ── Tabla usuarios (id == auth.users.id) ────────────────────────
create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade
);
alter table public.usuarios
  add column if not exists email              text,
  add column if not exists alias              text,
  add column if not exists nombre             text,
  add column if not exists avatar_url         text,
  add column if not exists puntos_disponibles integer not null default 0,
  add column if not exists puntos_totales     integer not null default 0,
  add column if not exists giros_gratis       integer not null default 0,
  add column if not exists created_at         timestamptz not null default now();

-- ── Puntajes del minijuego (ranking semanal/mensual) ────────────
create table if not exists public.puntajes_mensuales (
  id bigint generated always as identity primary key
);
alter table public.puntajes_mensuales
  add column if not exists usuario_id uuid references public.usuarios(id) on delete cascade,
  add column if not exists alias      text,
  add column if not exists puntaje    integer not null default 0,
  add column if not exists metros     integer not null default 0,
  add column if not exists creado_en  timestamptz not null default now();
create index if not exists idx_puntajes_creado  on public.puntajes_mensuales (creado_en);
create index if not exists idx_puntajes_usuario on public.puntajes_mensuales (usuario_id);

-- ── Premios ganados en la ruleta (los gestiona el dueño a mano) ─
create table if not exists public.premios_ruleta (
  id bigint generated always as identity primary key
);
alter table public.premios_ruleta
  add column if not exists usuario_id uuid references public.usuarios(id) on delete cascade,
  add column if not exists tipo       text,                 -- 'envio_gratis' | 'zapas_gratis'
  add column if not exists estado     text not null default 'pendiente',
  add column if not exists creado_en  timestamptz not null default now();

-- ── Asociar pedidos al usuario (compra anónima sigue válida) ────
alter table public.pedidos add column if not exists usuario_id uuid references public.usuarios(id);

-- ── Alta automática del usuario al primer login (Google) ────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.usuarios (id, email, nombre, alias, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''), '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RPCs atómicos de puntos (security definer) ──────────────────
-- Suma puntos a disponibles y totales (al guardar un puntaje).
create or replace function public.sumar_puntos(p_usuario_id uuid, p_delta integer)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare nuevo integer;
begin
  update public.usuarios
     set puntos_disponibles = puntos_disponibles + greatest(p_delta, 0),
         puntos_totales     = puntos_totales + greatest(p_delta, 0)
   where id = p_usuario_id
   returning puntos_disponibles into nuevo;
  return nuevo;
end;
$$;

-- Descuenta el costo de un giro. Devuelve true si había saldo (atómico).
create or replace function public.gastar_puntos(p_usuario_id uuid, p_costo integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare ok boolean;
begin
  update public.usuarios
     set puntos_disponibles = puntos_disponibles - p_costo
   where id = p_usuario_id
     and puntos_disponibles >= p_costo
   returning true into ok;
  return coalesce(ok, false);
end;
$$;

-- ── RLS: todo se accede vía service_role en el backend ──────────
-- RLS habilitado sin políticas permisivas → bloquea anon/authenticated.
-- El service_role (Vercel Functions) ignora RLS.
alter table public.usuarios            enable row level security;
alter table public.puntajes_mensuales  enable row level security;
alter table public.premios_ruleta      enable row level security;
