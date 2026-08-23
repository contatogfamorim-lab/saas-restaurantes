-- =============================================================================
-- 0008 — Operação: waiter_calls, session_adjustments, payments, menu_events
-- =============================================================================

create table public.waiter_calls (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  session_id    uuid not null,
  table_id      uuid not null,
  type          public.waiter_call_type not null,
  status        public.waiter_call_status not null default 'open',
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid,
  updated_at    timestamptz not null default now(),

  foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete cascade,
  foreign key (table_id, restaurant_id)
    references public.restaurant_tables (id, restaurant_id) on delete restrict,
  foreign key (resolved_by, restaurant_id)
    references public.profiles (id, restaurant_id) on delete set null,

  check (status = 'open' or resolved_at is not null)
);

-- um chamado aberto por tipo e por sessão: tocar 5x no botão não vira 5 alertas
create unique index waiter_calls_one_open_per_type
  on public.waiter_calls (session_id, type) where status = 'open';

create index waiter_calls_open_idx
  on public.waiter_calls (restaurant_id, created_at) where status = 'open';

-- -----------------------------------------------------------------------------
-- session_adjustments — descontos e remoção de taxa de serviço.
-- Tabela própria em vez de colunas na comanda: o dashboard do dono precisa
-- listar "descontos por funcionário" (spec §10.8), e coluna não guarda
-- histórico de quem fez o quê.
-- -----------------------------------------------------------------------------
create type public.adjustment_type as enum ('discount', 'service_fee_waiver');

create table public.session_adjustments (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  session_id     uuid not null,
  type           public.adjustment_type not null,
  -- discount → valor absoluto em centavos, já resolvido a partir de valor ou %
  amount_cents   int not null default 0 check (amount_cents >= 0),
  -- guardado só para exibir "10% de desconto" na conta impressa
  percent        numeric(5,2) check (percent > 0 and percent <= 100),
  reason         text not null check (length(btrim(reason)) between 3 and 300),
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete restrict,
  foreign key (created_by, restaurant_id)
    references public.profiles (id, restaurant_id) on delete restrict
);

-- a taxa se remove uma vez só por comanda
create unique index session_adjustments_one_fee_waiver
  on public.session_adjustments (session_id) where type = 'service_fee_waiver';

create index session_adjustments_session_idx
  on public.session_adjustments (session_id);
create index session_adjustments_audit_idx
  on public.session_adjustments (restaurant_id, created_by, created_at desc);

comment on column public.session_adjustments.reason is
  'Motivo OBRIGATÓRIO. Desconto sem justificativa é o vetor de fraude interna '
  'mais comum neste tipo de sistema (spec §10.7).';

-- -----------------------------------------------------------------------------
-- payments
-- -----------------------------------------------------------------------------
create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  session_id     uuid not null,
  method         public.payment_method not null,
  -- valor efetivamente ABATIDO da conta
  amount_cents   int not null check (amount_cents > 0),
  -- só para dinheiro: o que o cliente entregou. O troco é a diferença.
  tendered_cents int check (tendered_cents > 0),
  created_by     uuid not null,
  idempotency_key text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete restrict,
  foreign key (created_by, restaurant_id)
    references public.profiles (id, restaurant_id) on delete restrict,
  unique (restaurant_id, idempotency_key),

  -- troco só existe em dinheiro, e nunca é negativo (spec §10.7)
  check (tendered_cents is null or method = 'dinheiro'),
  check (tendered_cents is null or tendered_cents >= amount_cents)
);

create index payments_session_idx on public.payments (session_id, created_at);
create index payments_report_idx
  on public.payments (restaurant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- menu_events — analytics do cardápio. É o dado que PDV nenhum tem:
-- alimenta a taxa de conversão por produto no dashboard do dono (spec §8).
-- -----------------------------------------------------------------------------
create table public.menu_events (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  session_id    uuid,
  guest_id      uuid,
  product_id    uuid not null,
  event_type    public.menu_event_type not null,
  created_at    timestamptz not null default now(),

  foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete set null,
  foreign key (guest_id, restaurant_id)
    references public.session_guests (id, restaurant_id) on delete set null,
  foreign key (product_id, restaurant_id)
    references public.products (id, restaurant_id) on delete cascade
);

create index menu_events_rollup_idx
  on public.menu_events (restaurant_id, product_id, event_type, created_at);

create trigger touch_waiter_calls before update on public.waiter_calls
  for each row execute function app.touch_updated_at();
create trigger touch_session_adjustments before update on public.session_adjustments
  for each row execute function app.touch_updated_at();
create trigger touch_payments before update on public.payments
  for each row execute function app.touch_updated_at();
