-- =============================================================================
-- 0004 — Cardápio: categories, products, modificadores
-- =============================================================================

create type public.diet_tag as enum (
  'vegetariano', 'vegano', 'sem_gluten', 'sem_lactose', 'apimentado'
);

create type public.product_badge as enum (
  'novo', 'mais_pedido', 'picante', 'da_casa'
);

-- -----------------------------------------------------------------------------
-- Janela de serviço (cardápio dinâmico). Convenção de dia da semana:
-- 0 = domingo … 6 = sábado — igual a `extract(dow)` no Postgres e a
-- `Date.getDay()` no JS, para não haver conversão em lugar nenhum.
-- -----------------------------------------------------------------------------
create or replace function app.is_within_service_window(
  p_from       time,
  p_to         time,
  p_days       int[],
  p_timezone   text default 'America/Sao_Paulo',
  p_at         timestamptz default now()
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  local_ts  timestamp;
  local_dow int;
  local_tm  time;
begin
  local_ts  := p_at at time zone coalesce(p_timezone, 'America/Sao_Paulo');
  local_dow := extract(dow from local_ts)::int;
  local_tm  := local_ts::time;

  -- janela que cruza a meia-noite (bar 18h–02h) pertence ao dia em que ABRIU
  if p_from is not null and p_to is not null and p_to < p_from
     and local_tm < p_to then
    local_dow := (local_dow + 6) % 7;
  end if;

  if p_days is not null and array_length(p_days, 1) is not null
     and not (local_dow = any(p_days)) then
    return false;
  end if;

  if p_from is null or p_to is null then
    return true;
  end if;

  if p_to >= p_from then
    return local_tm >= p_from and local_tm < p_to;
  else
    return local_tm >= p_from or local_tm < p_to;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
create table public.categories (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  name           text not null check (length(btrim(name)) between 1 and 80),
  sort_order     int not null default 0,
  station        public.station not null default 'cozinha',
  available_from time,
  available_to   time,
  days_of_week   int[] check (days_of_week <@ array[0,1,2,3,4,5,6]),
  archived_at    timestamptz,
  archived_by    uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (id, restaurant_id),
  -- ou define os dois lados da janela, ou nenhum
  check ((available_from is null) = (available_to is null))
);

create index categories_restaurant_idx
  on public.categories (restaurant_id, sort_order) where archived_at is null;

-- -----------------------------------------------------------------------------
create table public.products (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  category_id    uuid not null,
  name           text not null check (length(btrim(name)) between 1 and 120),
  description    text check (length(description) <= 600),
  price_cents    int not null check (price_cents >= 0),
  image_url      text,
  is_available   boolean not null default true,
  sort_order     int not null default 0,
  prep_minutes   int not null default 15 check (prep_minutes between 0 and 480),
  serves_people  numeric(3,1) not null default 1 check (serves_people > 0),
  diet_tags      public.diet_tag[] not null default '{}',
  badges         public.product_badge[] not null default '{}',
  station_override public.station,
  -- "Acabou hoje" (spec §12.2): religa sozinho na próxima abertura da casa.
  auto_reactivate_at timestamptz,
  archived_at    timestamptz,
  archived_by    uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- FK COMPOSTO: impede que um produto do restaurante A aponte para uma
  -- categoria do restaurante B. Isolamento garantido pelo schema, não por policy.
  foreign key (category_id, restaurant_id)
    references public.categories (id, restaurant_id) on delete restrict,
  unique (id, restaurant_id)
);

comment on column public.products.price_cents is
  'SEMPRE centavos (integer). Nunca float. É o preço VIGENTE — a conta já '
  'aberta usa o snapshot em order_items.unit_price_cents (spec §3, regra 1).';
comment on column public.products.auto_reactivate_at is
  'Quando preenchido, um job religa is_available na próxima abertura da casa. '
  'O dono não precisa lembrar de reativar amanhã.';

create index products_restaurant_idx
  on public.products (restaurant_id, category_id, sort_order)
  where archived_at is null;
create index products_available_idx
  on public.products (restaurant_id) where is_available and archived_at is null;
create index products_reactivate_idx
  on public.products (auto_reactivate_at) where auto_reactivate_at is not null;

-- -----------------------------------------------------------------------------
-- Grupos de modificadores são REUTILIZÁVEIS entre produtos (spec §12.6):
-- "Ponto da carne" se cria uma vez e se aplica em 12 pratos.
-- -----------------------------------------------------------------------------
create table public.modifier_groups (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  name           text not null check (length(btrim(name)) between 1 and 80),
  min_select     int not null default 0 check (min_select >= 0),
  max_select     int not null default 1 check (max_select >= 1),
  is_required    boolean not null default false,
  sort_order     int not null default 0,
  archived_at    timestamptz,
  archived_by    uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (id, restaurant_id),
  check (max_select >= min_select),
  -- grupo obrigatório sem mínimo é contradição: trava a UI do cliente
  check (not is_required or min_select >= 1)
);

create table public.modifier_options (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants(id) on delete restrict,
  group_id          uuid not null,
  name              text not null check (length(btrim(name)) between 1 and 80),
  price_delta_cents int not null default 0,
  is_available      boolean not null default true,
  sort_order        int not null default 0,
  archived_at       timestamptz,
  archived_by       uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  foreign key (group_id, restaurant_id)
    references public.modifier_groups (id, restaurant_id) on delete restrict,
  unique (id, restaurant_id)
);

create index modifier_options_group_idx
  on public.modifier_options (group_id, sort_order) where archived_at is null;

-- N:N produto ↔ grupo de modificadores
create table public.product_modifier_groups (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  product_id     uuid not null,
  group_id       uuid not null,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  foreign key (product_id, restaurant_id)
    references public.products (id, restaurant_id) on delete cascade,
  foreign key (group_id, restaurant_id)
    references public.modifier_groups (id, restaurant_id) on delete restrict,
  unique (product_id, group_id)
);

create index product_modifier_groups_product_idx
  on public.product_modifier_groups (product_id, sort_order);

create trigger touch_categories before update on public.categories
  for each row execute function app.touch_updated_at();
create trigger touch_products before update on public.products
  for each row execute function app.touch_updated_at();
create trigger touch_modifier_groups before update on public.modifier_groups
  for each row execute function app.touch_updated_at();
create trigger touch_modifier_options before update on public.modifier_options
  for each row execute function app.touch_updated_at();
create trigger touch_product_modifier_groups before update on public.product_modifier_groups
  for each row execute function app.touch_updated_at();
