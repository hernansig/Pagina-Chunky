-- ═══════════════════════════════════════════════════════════════════
--  MIGRACIÓN: cupones de la ruleta + envío fijo
--  Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
--
--  Los premios de la ruleta pasan a ser CUPONES de descuento:
--   · desc_200      → $200 OFF
--   · desc_500      → $500 OFF
--   · envio_gratis  → no cobra el envío
--  Ciclo de vida de un item de `items_usuario`:
--   · estado 'disponible' (ganado, en la cuenta) → vence al reiniciar la
--     semana del ranking (se filtra por obtenido_en en el backend).
--   · al CANJEAR → estado 'canjeado' + `codigo` único + `expira_en` = +10 días.
--     Ese código se pega en el carrito para aplicar el descuento.
--   · al usarse en una compra → `usado_en` (no acumulable, un solo uso).
-- ═══════════════════════════════════════════════════════════════════

alter table items_usuario add column if not exists codigo     text;
alter table items_usuario add column if not exists expira_en   timestamptz;
alter table items_usuario add column if not exists usado_en    timestamptz;
create unique index if not exists uniq_items_codigo on items_usuario (codigo) where codigo is not null;
create index if not exists idx_items_cupon_vigente
  on items_usuario (codigo) where estado = 'canjeado' and usado_en is null;

-- Pedidos: cupón aplicado + desglose de envío/descuento (para registro y mails).
alter table pedidos add column if not exists cupon_codigo text;
alter table pedidos add column if not exists envio        integer not null default 0;
alter table pedidos add column if not exists descuento    integer not null default 0;
