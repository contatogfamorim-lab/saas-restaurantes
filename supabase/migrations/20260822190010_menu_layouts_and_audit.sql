-- =============================================================================
-- 0009 — Editor de cardápio (layouts em blocos) e audit_log imutável
-- =============================================================================

create table public.menu_layouts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  status        public.menu_layout_status not null default 'draft',
  version       int not null default 1 check (version >= 1),
  published_at  timestamptz,
  published_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  foreign key (published_by, restaurant_id)
    references public.profiles (id, restaurant_id) on delete set null,
  unique (id, restaurant_id),
  unique (restaurant_id, version),
  check (status <> 'published' or published_at is not null)
);

-- exatamente um rascunho e um layout publicado vigente por restaurante.
-- As versões publicadas antigas ficam com status 'published' e published_at
-- anterior — a reversão em um clique (spec §12.8) republica uma delas.
create unique index menu_layouts_one_draft
  on public.menu_layouts (restaurant_id) where status = 'draft';

create index menu_layouts_published_idx
  on public.menu_layouts (restaurant_id, published_at desc) where status = 'published';

-- -----------------------------------------------------------------------------
-- menu_blocks — BLOCO GUARDA APRESENTAÇÃO, NUNCA DADO DE PRODUTO (spec §12.10).
-- config referencia product_id/category_id; nome e preço continuam vindo de
-- products. Duplicar dado de produto aqui é inconsistência garantida.
-- -----------------------------------------------------------------------------
create table public.menu_blocks (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete restrict,
  layout_id       uuid not null,
  parent_block_id uuid references public.menu_blocks(id) on delete cascade,
  type            public.menu_block_type not null,
  sort_order      int not null default 0,
  config          jsonb not null default '{}'::jsonb,
  is_hidden       boolean not null default false,
  visible_from    time,
  visible_to      time,
  days_of_week    int[] check (days_of_week <@ array[0,1,2,3,4,5,6]),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  foreign key (layout_id, restaurant_id)
    references public.menu_layouts (id, restaurant_id) on delete cascade,
  unique (id, restaurant_id),
  check ((visible_from is null) = (visible_to is null)),
  check (jsonb_typeof(config) = 'object'),
  check (parent_block_id is distinct from id)
);

create index menu_blocks_layout_idx
  on public.menu_blocks (layout_id, parent_block_id, sort_order);

comment on column public.menu_blocks.config is
  'Só apresentação: variação de layout, título, product_id/category_id '
  'referenciados. Jamais nome, preço ou foto copiados de products.';

-- =============================================================================
-- audit_log — IMUTÁVEL
-- =============================================================================
-- Em restaurante o prejuízo quase sempre vem de dentro. Esta tabela é a
-- funcionalidade de segurança mais valiosa do sistema (spec §10.8).
-- Sem updated_at de propósito: linha de auditoria não se atualiza.
-- =============================================================================
create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  actor_type    public.audit_actor_type not null,
  -- sem FK: a linha precisa sobreviver ao desligamento do funcionário
  actor_id      uuid,
  action        text not null check (length(btrim(action)) between 1 and 80),
  entity_type   text not null check (length(btrim(entity_type)) between 1 and 60),
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  ip            inet,
  user_agent    text check (length(user_agent) <= 500),
  created_at    timestamptz not null default now()
);

create index audit_log_lookup_idx
  on public.audit_log (restaurant_id, created_at desc);
create index audit_log_actor_idx
  on public.audit_log (restaurant_id, actor_id, created_at desc);
create index audit_log_action_idx
  on public.audit_log (restaurant_id, action, created_at desc);
create index audit_log_entity_idx
  on public.audit_log (restaurant_id, entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- Imutabilidade real.
-- RLS sozinha NÃO basta: service_role a ignora, e todas as escritas do sistema
-- passam por service_role. Um trigger vale para qualquer papel não-superusuário.
-- -----------------------------------------------------------------------------
create or replace function app.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log é append-only: % não é permitido', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function app.audit_log_is_append_only();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function app.audit_log_is_append_only();

create trigger touch_menu_layouts before update on public.menu_layouts
  for each row execute function app.touch_updated_at();
create trigger touch_menu_blocks before update on public.menu_blocks
  for each row execute function app.touch_updated_at();
