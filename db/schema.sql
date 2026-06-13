-- ═══════════════════════════════════════════════════════════════════
--  CHUNKY SNKRS — Schema de base de datos (Supabase / Postgres)
--  Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════

-- Para generar IDs aleatorios y códigos públicos.
create extension if not exists "pgcrypto";

-- ───────────────────────────────────────────────────────────────────
--  PRODUCTOS
-- ───────────────────────────────────────────────────────────────────
create table if not exists productos (
  id                uuid primary key default gen_random_uuid(),
  nombre            text        not null,
  precio            numeric(12,2) not null check (precio >= 0),
  foto_url          text,
  talle             text,
  stock_total       integer     not null default 1 check (stock_total >= 0),
  stock_disponible  integer     not null default 1 check (stock_disponible >= 0),
  stock_reservado   integer     not null default 0 check (stock_reservado >= 0),
  activo            boolean     not null default true,
  orden             integer     not null default 0,   -- para ordenar el catálogo
  created_at        timestamptz not null default now()
);
create index if not exists idx_productos_activo on productos (activo, orden);

-- ───────────────────────────────────────────────────────────────────
--  PEDIDOS
--  estado_pago lo controla EXCLUSIVAMENTE el webhook de MercadoPago.
-- ───────────────────────────────────────────────────────────────────
create table if not exists pedidos (
  id                uuid primary key default gen_random_uuid(),
  codigo_publico    text        not null unique,          -- ej: CHK-7F3A9K
  cliente_nombre    text,
  cliente_contacto  text,                                  -- email del comprador
  productos         jsonb       not null default '[]',     -- [{producto_id, nombre, precio, cantidad}]
  monto_total       numeric(12,2) not null default 0,
  estado_pago       text        not null default 'pendiente'
                      check (estado_pago in ('pendiente','pagado','rechazado')),
  estado_envio      text        not null default 'preparando'
                      check (estado_envio in ('preparando','enviado','entregado')),
  mp_preference_id  text,
  mp_payment_id     text,
  enviado_at        timestamptz,                           -- cuándo pasó a "enviado" (para cron de reseñas)
  resena_pedida_at  timestamptz,                           -- último mail de reseña enviado
  created_at        timestamptz not null default now()
);
create index if not exists idx_pedidos_codigo on pedidos (codigo_publico);
create index if not exists idx_pedidos_pago on pedidos (estado_pago);
create index if not exists idx_pedidos_envio on pedidos (estado_envio, enviado_at);

-- ───────────────────────────────────────────────────────────────────
--  RESERVAS
--  Al reservar, el producto queda bloqueado 24hs para ese mail.
-- ───────────────────────────────────────────────────────────────────
create table if not exists reservas (
  id                uuid primary key default gen_random_uuid(),
  producto_id       uuid        not null references productos(id) on delete cascade,
  cliente_contacto  text        not null,                  -- email que hizo la reserva
  estado            text        not null default 'activa'
                      check (estado in ('activa','vencida','convertida_en_pedido')),
  recordatorio_10h  boolean     not null default false,
  recordatorio_20h  boolean     not null default false,
  creado_en         timestamptz not null default now(),
  expira_en         timestamptz not null default (now() + interval '24 hours')
);
create index if not exists idx_reservas_estado on reservas (estado, expira_en);
create index if not exists idx_reservas_producto on reservas (producto_id, estado);

-- ───────────────────────────────────────────────────────────────────
--  ENCARGOS
-- ───────────────────────────────────────────────────────────────────
create table if not exists encargos (
  id                uuid primary key default gen_random_uuid(),
  cliente_nombre    text        not null,
  contacto          text        not null,                  -- email o teléfono
  producto_deseado  text        not null,
  talle             text,
  detalles          text,
  estado            text        not null default 'pendiente'
                      check (estado in ('pendiente','cotizado','confirmado')),
  created_at        timestamptz not null default now()
);
create index if not exists idx_encargos_estado on encargos (estado, created_at);

-- ───────────────────────────────────────────────────────────────────
--  JUGADORES (minijuego + ruleta)
-- ───────────────────────────────────────────────────────────────────
create table if not exists jugadores (
  id                  uuid primary key default gen_random_uuid(),
  alias               text        not null,
  contacto            text,
  puntos_totales      integer     not null default 0,      -- histórico acumulado
  puntos_disponibles  integer     not null default 0,      -- saldo canjeable en la ruleta
  created_at          timestamptz not null default now()
);
create index if not exists idx_jugadores_alias on jugadores (lower(alias));

-- ───────────────────────────────────────────────────────────────────
--  PUNTAJES MENSUALES (ranking que se resetea cada mes)
-- ───────────────────────────────────────────────────────────────────
create table if not exists puntajes_mensuales (
  id          uuid primary key default gen_random_uuid(),
  jugador_id  uuid not null references jugadores(id) on delete cascade,
  mes         text not null,                               -- 'YYYY-MM'
  puntaje     integer not null default 0,
  unique (jugador_id, mes)
);
create index if not exists idx_puntajes_mes on puntajes_mensuales (mes, puntaje desc);

-- ───────────────────────────────────────────────────────────────────
--  SESIONES DE MINIJUEGO (anti-abuso: token server-side por partida)
-- ───────────────────────────────────────────────────────────────────
create table if not exists minijuego_sesiones (
  id          uuid primary key default gen_random_uuid(),
  jugador_id  uuid references jugadores(id) on delete set null,
  token       text not null unique,
  iniciado_en timestamptz not null default now(),
  cerrado     boolean not null default false,
  puntaje     integer
);
create index if not exists idx_minijuego_token on minijuego_sesiones (token);

-- ───────────────────────────────────────────────────────────────────
--  RESEÑAS (quedan en "pendiente" hasta que el dueño las aprueba)
-- ───────────────────────────────────────────────────────────────────
create table if not exists resenas (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid references pedidos(id) on delete set null,
  cliente_nombre  text,
  texto           text not null,
  rating          integer not null check (rating between 1 and 5),
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente','aprobada','rechazada')),
  token           text unique,                             -- link único del mail
  created_at      timestamptz not null default now()
);
create index if not exists idx_resenas_estado on resenas (estado, created_at desc);

-- ───────────────────────────────────────────────────────────────────
--  PREMIOS DE LA RULETA
--  Cuando stock_disponible_mes llega a 0, el premio deja de salir.
-- ───────────────────────────────────────────────────────────────────
create table if not exists premios_ruleta (
  id                    uuid primary key default gen_random_uuid(),
  nombre                text not null,
  tipo                  text not null
                          check (tipo in ('premio_real','giro_extra','nada')),
  peso_probabilidad     integer not null default 1 check (peso_probabilidad >= 0),
  stock_disponible_mes  integer,                           -- null = ilimitado (giro_extra / nada)
  orden                 integer not null default 0,
  activo                boolean not null default true
);

-- Log de cada giro (auditoría + control de premios entregados).
create table if not exists ruleta_giros (
  id          uuid primary key default gen_random_uuid(),
  jugador_id  uuid references jugadores(id) on delete set null,
  premio_id   uuid references premios_ruleta(id) on delete set null,
  premio_nombre text,
  puntos_gastados integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
--  El backend usa la service_role key (que ignora RLS). Activamos RLS
--  y NO creamos políticas públicas: nadie puede leer/escribir estas
--  tablas con la anon key. Todo pasa por las Vercel Functions.
-- ═══════════════════════════════════════════════════════════════════
alter table productos          enable row level security;
alter table pedidos            enable row level security;
alter table reservas           enable row level security;
alter table encargos           enable row level security;
alter table jugadores          enable row level security;
alter table puntajes_mensuales enable row level security;
alter table minijuego_sesiones enable row level security;
alter table resenas            enable row level security;
alter table premios_ruleta     enable row level security;
alter table ruleta_giros       enable row level security;

-- ═══════════════════════════════════════════════════════════════════
--  FUNCIÓN ATÓMICA: descontar stock al confirmar pago (evita sobreventa)
-- ═══════════════════════════════════════════════════════════════════
create or replace function descontar_stock(p_producto_id uuid, p_cantidad integer)
returns void language plpgsql as $$
begin
  update productos
     set stock_disponible = greatest(stock_disponible - p_cantidad, 0)
   where id = p_producto_id;
end;
$$;
