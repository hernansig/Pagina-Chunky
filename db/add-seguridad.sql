-- ═══════════════════════════════════════════════════════════════════
--  MIGRACIÓN: seguridad / anti-abuso
--  Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
--
--  Incluye:
--   1) juego_sesiones      → anti-cheat del minijuego (token por partida)
--   2) cobrar_giro_ruleta  → cobro atómico de la ruleta (sin condición de carrera)
--   3) rate_limits + rate_touch → límite de frecuencia distribuido
--   4) reservas            → índice único que impide doble reserva activa
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
--  1) ANTI-CHEAT DEL MINIJUEGO
--  El servidor entrega un token al empezar la partida y lo cierra al
--  guardar el puntaje (single-use). En guardar-puntaje se valida que los
--  metros/monedas sean físicamente posibles para el tiempo transcurrido.
-- ───────────────────────────────────────────────────────────────────
create table if not exists juego_sesiones (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid        not null references usuarios(id) on delete cascade,
  token        text        not null unique,
  iniciada_en  timestamptz not null default now(),
  cerrada      boolean     not null default false,
  metros       integer,
  monedas      integer
);
create index if not exists idx_juego_sesiones_token on juego_sesiones (token);
create index if not exists idx_juego_sesiones_usuario on juego_sesiones (usuario_id, iniciada_en desc);
alter table juego_sesiones enable row level security;

-- ───────────────────────────────────────────────────────────────────
--  2) COBRO ATÓMICO DE LA RULETA
--  Bloquea la fila del usuario (FOR UPDATE) y decide en una sola
--  transacción: giro gratis, o pago (con chequeo de límite y saldo).
--  Devuelve ok + motivo + saldos nuevos. Elimina el race de leer-y-escribir.
-- ───────────────────────────────────────────────────────────────────
create or replace function cobrar_giro_ruleta(
  p_usuario_id uuid, p_costo integer, p_limite integer, p_ref text
) returns table (ok boolean, motivo text, puntos integer, giros_gratis integer, giros_semana integer)
language plpgsql as $$
#variable_conflict use_column
-- ↑ los nombres de la tabla de retorno (giros_gratis, giros_semana) coinciden
--   con columnas de `usuarios`. Sin esto, "set giros_gratis = giros_gratis - 1"
--   es ambiguo y rompe el giro GRATIS. use_column → ante duda, usa la columna.
declare
  u record;
  v_sem integer;
begin
  select * into u from usuarios where id = p_usuario_id for update;
  if not found then
    return query select false, 'no_user', 0, 0, 0; return;
  end if;

  -- contador semanal: se reinicia si cambió la semana de referencia
  v_sem := case when u.giros_semana_ref = p_ref then coalesce(u.giros_semana, 0) else 0 end;

  -- 1) giro gratis (no cuenta contra el límite semanal ni cobra puntos)
  if coalesce(u.giros_gratis, 0) > 0 then
    update usuarios set giros_gratis = giros_gratis - 1,
                        giros_semana = v_sem, giros_semana_ref = p_ref
      where id = p_usuario_id;
    return query select true, 'gratis', u.puntos_disponibles, u.giros_gratis - 1, v_sem; return;
  end if;

  -- 2) pago: chequear límite semanal y saldo
  if v_sem >= p_limite then
    return query select false, 'limite', u.puntos_disponibles, coalesce(u.giros_gratis, 0), v_sem; return;
  end if;
  if coalesce(u.puntos_disponibles, 0) < p_costo then
    return query select false, 'saldo', u.puntos_disponibles, coalesce(u.giros_gratis, 0), v_sem; return;
  end if;

  update usuarios set puntos_disponibles = puntos_disponibles - p_costo,
                      giros_semana = v_sem + 1, giros_semana_ref = p_ref
    where id = p_usuario_id;
  return query select true, 'pago', u.puntos_disponibles - p_costo, coalesce(u.giros_gratis, 0), v_sem + 1;
end;
$$;

-- Suma giros gratis de forma atómica (premio "otro giro") y devuelve el nuevo total.
create or replace function sumar_giros_gratis(p_usuario_id uuid, p_delta integer)
returns integer language plpgsql as $$
declare v integer;
begin
  update usuarios set giros_gratis = coalesce(giros_gratis, 0) + p_delta
    where id = p_usuario_id returning giros_gratis into v;
  return coalesce(v, 0);
end;
$$;

-- ───────────────────────────────────────────────────────────────────
--  3) RATE LIMITING (distribuido, sobre Postgres)
--  rate_touch(clave, ventana_seg, max): registra un hit para `clave` y
--  devuelve true si sigue dentro del límite, false si lo excedió.
--  Ventana deslizante simple por clave (IP o usuario + acción).
-- ───────────────────────────────────────────────────────────────────
create table if not exists rate_limits (
  clave           text primary key,
  ventana_inicio  timestamptz not null default now(),
  contador        integer     not null default 0
);
alter table rate_limits enable row level security;

create or replace function rate_touch(p_clave text, p_ventana_seg integer, p_max integer)
returns boolean language plpgsql as $$
declare
  v_cont integer;
begin
  insert into rate_limits (clave, ventana_inicio, contador)
    values (p_clave, now(), 1)
  on conflict (clave) do update set
    contador = case
      when rate_limits.ventana_inicio < now() - make_interval(secs => p_ventana_seg) then 1
      else rate_limits.contador + 1 end,
    ventana_inicio = case
      when rate_limits.ventana_inicio < now() - make_interval(secs => p_ventana_seg) then now()
      else rate_limits.ventana_inicio end
  returning contador into v_cont;
  return v_cont <= p_max;
end;
$$;

-- ───────────────────────────────────────────────────────────────────
--  4) RESERVAS: una sola reserva ACTIVA por producto (a nivel DB)
--  Cierra la condición de carrera del "chequear activa → insertar":
--  dos inserts simultáneos del mismo producto → el segundo falla.
-- ───────────────────────────────────────────────────────────────────
create unique index if not exists uniq_reserva_activa_producto
  on reservas (producto_id) where estado = 'activa';

-- ───────────────────────────────────────────────────────────────────
--  5) RESERVA DE STOCK AL CREAR LA ORDEN (anti sobreventa)
--  Al ir a pagar se descuenta el stock de forma atómica y se marca el
--  pedido con stock_reservado + vencimiento. El webhook, si el pedido ya
--  tenía el stock reservado, NO vuelve a descontar (solo confirma). Si el
--  pago se rechaza o el checkout se abandona (cron), el stock se devuelve.
-- ───────────────────────────────────────────────────────────────────
alter table pedidos add column if not exists stock_reservado boolean not null default false;
alter table pedidos add column if not exists reserva_vence_en timestamptz;
create index if not exists idx_pedidos_reserva
  on pedidos (stock_reservado, reserva_vence_en) where estado_pago = 'pendiente';

-- Descuento atómico y condicional: resta sólo si hay stock suficiente.
-- Devuelve true si reservó, false si no había stock (sin tocar la fila).
create or replace function reservar_stock(p_producto_id uuid, p_cantidad integer)
returns boolean language plpgsql as $$
declare afectadas integer;
begin
  update productos set stock_disponible = stock_disponible - p_cantidad
    where id = p_producto_id and stock_disponible >= p_cantidad;
  get diagnostics afectadas = row_count;
  return afectadas > 0;
end;
$$;

create or replace function reservar_stock_variante(p_variante_id uuid, p_cantidad integer)
returns boolean language plpgsql as $$
declare afectadas integer;
begin
  update producto_variantes set stock_disponible = stock_disponible - p_cantidad
    where id = p_variante_id and stock_disponible >= p_cantidad;
  get diagnostics afectadas = row_count;
  return afectadas > 0;
end;
$$;

-- Devolución de stock reservado (pago rechazado o checkout vencido).
create or replace function devolver_stock(p_producto_id uuid, p_cantidad integer)
returns void language plpgsql as $$
begin
  update productos set stock_disponible = stock_disponible + p_cantidad
    where id = p_producto_id;
end;
$$;

create or replace function devolver_stock_variante(p_variante_id uuid, p_cantidad integer)
returns void language plpgsql as $$
begin
  update producto_variantes set stock_disponible = stock_disponible + p_cantidad
    where id = p_variante_id;
end;
$$;
