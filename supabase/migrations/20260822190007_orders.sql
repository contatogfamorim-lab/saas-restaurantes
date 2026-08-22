-- =============================================================================
-- 0007 — orders, order_items, order_item_modifiers
-- =============================================================================

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete restrict,
  session_id         uuid not null,
  guest_id           uuid,              -- null quando veio do garçom
  created_by_staff_id uuid,             -- null quando veio do cliente
  source             public.order_source not null,
  status             public.order_status not null default 'pending_approval',
  approved_by        uuid,
  approved_at        timestamptz,
  -- spec §13.7: toda escrita é comando idempotente. Sem isto, a sincronização
  -- pós-queda DUPLICA pedido — o pior bug possível em cozinha cheia.
  idempotency_key    text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete restrict,
  foreign key (guest_id, restaurant_id)
    references public.session_guests (id, restaurant_id) on delete restrict,
  foreign key (created_by_staff_id, restaurant_id)
    references public.profiles (id, restaurant_id) on delete set null,
  foreign key (approved_by, restaurant_id)
    references public.profiles (id, restaurant_id) on delete set null,
  unique (id, restaurant_id),
  unique (restaurant_id, idempotency_key),

  -- a origem tem que bater com quem assinou o pedido
  check (
    case source
      when 'guest'  then guest_id is not null and created_by_staff_id is null
      when 'waiter' then created_by_staff_id is not null
    end
  ),
  check (status not in ('approved', 'partially_approved') or approved_by is not null)
);

create index orders_pending_idx
  on public.orders (restaurant_id, created_at)
  where status = 'pending_approval';
create index orders_session_idx on public.orders (session_id, created_at);

comment on column public.orders.idempotency_key is
  'Gerada no cliente. Repetir o mesmo comando não cria pedido duplicado — '
  'o unique (restaurant_id, idempotency_key) rejeita a segunda tentativa.';

-- -----------------------------------------------------------------------------
-- order_items
-- -----------------------------------------------------------------------------
create table public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references public.restaurants(id) on delete restrict,
  order_id             uuid not null,
  product_id           uuid not null,
  -- quem VAI COMER. É isto que permite dividir a conta por pessoa.
  guest_id             uuid,
  qty                  int not null check (qty between 1 and 20),
  unit_price_cents     int not null check (unit_price_cents >= 0),
  total_price_cents    int not null check (total_price_cents >= 0),
  notes                text check (length(notes) <= 280),

  promotion_id         uuid,
  original_price_cents int check (original_price_cents >= 0),

  status               public.order_item_status not null default 'pending',
  station              public.station not null,
  course               int not null default 2 check (course in (1, 2, 3)),

  queued_at            timestamptz,
  started_at           timestamptz,
  ready_at             timestamptz,
  delivered_at         timestamptz,
  rejection_reason     public.rejection_reason,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  foreign key (order_id, restaurant_id)
    references public.orders (id, restaurant_id) on delete cascade,
  foreign key (product_id, restaurant_id)
    references public.products (id, restaurant_id) on delete restrict,
  foreign key (guest_id, restaurant_id)
    references public.session_guests (id, restaurant_id) on delete restrict,
  foreign key (promotion_id, restaurant_id)
    references public.promotions (id, restaurant_id) on delete restrict,
  unique (id, restaurant_id),

  -- promoção aplicada exige o preço cheio ao lado, para o dashboard medir
  -- o desconto concedido e para provar o "de/por" ao consumidor
  check (promotion_id is null or original_price_cents is not null)
);

comment on column public.order_items.unit_price_cents is
  'SNAPSHOT do preço no momento do pedido, já com promoção aplicada. '
  'NUNCA recalcular via JOIN em products.price_cents: mudar o preço amanhã não '
  'pode alterar a conta de hoje (spec §3, regra 1).';
comment on column public.order_items.queued_at is
  'Marcado na APROVAÇÃO do garçom, não no envio do cliente. O cronômetro da '
  'cozinha começa aqui (spec §16).';

create index order_items_order_idx on public.order_items (order_id);
create index order_items_kds_idx
  on public.order_items (restaurant_id, station, queued_at)
  where status in ('queued', 'preparing');
create index order_items_ready_idx
  on public.order_items (restaurant_id, ready_at)
  where status = 'ready';
create index order_items_guest_idx
  on public.order_items (guest_id) where guest_id is not null;

-- -----------------------------------------------------------------------------
-- order_item_modifiers — SNAPSHOT, não FK viva.
-- Guarda NOME e VALOR do modificador. Se o dono renomear "Mal passado" ou
-- mudar o preço do bacon, a comanda de hoje continua dizendo o que foi pedido.
-- -----------------------------------------------------------------------------
create table public.order_item_modifiers (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants(id) on delete restrict,
  order_item_id     uuid not null,
  group_name        text not null check (length(btrim(group_name)) between 1 and 80),
  option_name       text not null check (length(btrim(option_name)) between 1 and 80),
  price_delta_cents int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  foreign key (order_item_id, restaurant_id)
    references public.order_items (id, restaurant_id) on delete cascade
);

create index order_item_modifiers_item_idx
  on public.order_item_modifiers (order_item_id);

create trigger touch_orders before update on public.orders
  for each row execute function app.touch_updated_at();
create trigger touch_order_items before update on public.order_items
  for each row execute function app.touch_updated_at();
create trigger touch_order_item_modifiers before update on public.order_item_modifiers
  for each row execute function app.touch_updated_at();
