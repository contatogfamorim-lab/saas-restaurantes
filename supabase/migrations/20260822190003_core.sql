-- =============================================================================
-- 0003 — Núcleo multi-tenant: restaurants, profiles, restaurant_tables
-- =============================================================================

create table public.restaurants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) between 1 and 120),
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_url          text,
  brand_color       text not null default '#111827'
                      check (brand_color ~* '^#[0-9a-f]{6}$'),
  service_fee_pct   numeric(5,2) not null default 10
                      check (service_fee_pct >= 0 and service_fee_pct <= 100),
  require_phone     boolean not null default false,
  require_waiter_to_open_table boolean not null default false,
  currency          text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  timezone          text not null default 'America/Sao_Paulo',
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.restaurants.service_fee_pct is
  'Percentual, não centavos. O valor em centavos é derivado na view session_totals.';

-- -----------------------------------------------------------------------------
-- profiles — equipe. Um funcionário ACUMULA funções (spec P1b).
-- -----------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  name           text not null check (length(btrim(name)) between 1 and 120),
  pin_hash       text,
  -- coalesce é essencial: array_length('{}', 1) devolve NULL, e `NULL >= 1`
  -- é NULL, que o CHECK aceita. Sem isto, um profile SEM NENHUM papel passaria.
  roles          public.staff_role[] not null default '{}'
                   check (coalesce(array_length(roles, 1), 0) >= 1),
  permissions    text[] not null default '{}',
  active         boolean not null default true,
  pin_failed_attempts int not null default 0 check (pin_failed_attempts >= 0),
  pin_locked_until    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- alvo do FK composto: garante que qualquer filho referenciando um profile
  -- carregue o MESMO restaurant_id. Isolamento estrutural, não só por policy.
  unique (id, restaurant_id)
);

comment on column public.profiles.roles is
  'ARRAY de staff_role. Sempre testar com has_role() / = any(). Nunca igualdade.';
comment on column public.profiles.permissions is
  'Concessões delegadas do editor de cardápio (spec §12.9): menu.availability, '
  'menu.content, menu.price, menu.structure, menu.publish, menu.promotion. '
  'Somam-se ao padrão da função — ver lib/permissions.ts.';
comment on column public.profiles.pin_hash is
  'argon2id. Nulo enquanto o funcionário não cadastrar PIN.';

create index profiles_restaurant_idx on public.profiles (restaurant_id) where active;
create index profiles_roles_idx on public.profiles using gin (roles);

-- -----------------------------------------------------------------------------
-- restaurant_tables — "tables" é palavra reservada, não usar.
-- -----------------------------------------------------------------------------
create table public.restaurant_tables (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  label          text not null check (length(btrim(label)) between 1 and 40),
  area           text not null default 'Salão',
  seats          int not null default 4 check (seats between 1 and 40),
  -- gravado na etiqueta NFC. NUNCA muda, nem quando a mesa é liberada.
  short_code     text not null unique default app.generate_short_code(10)
                   check (length(short_code) >= 10),
  tag_uid        text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (restaurant_id, label),
  unique (id, restaurant_id)
);

comment on column public.restaurant_tables.short_code is
  'nanoid 10 aleatório, único global. Vai impresso no adesivo e gravado na tag. '
  'Estável para sempre: liberar a mesa NÃO regenera o código.';

create index restaurant_tables_restaurant_idx
  on public.restaurant_tables (restaurant_id) where active;

-- triggers de updated_at
create trigger touch_restaurants before update on public.restaurants
  for each row execute function app.touch_updated_at();
create trigger touch_profiles before update on public.profiles
  for each row execute function app.touch_updated_at();
create trigger touch_restaurant_tables before update on public.restaurant_tables
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Ninguém edita os próprios roles/permissions. Nem o owner (spec §10.3).
-- Vale contra service_role também, por isso é trigger e não policy.
--
-- `restaurant_id` e `active` entram na mesma trava: a policy `profiles_self_update`
-- deixa cada funcionário manter o próprio nome e PIN, e sem esta guarda ele
-- poderia reescrever o próprio restaurant_id e pular para outro tenant — ou
-- se reativar depois de desligado.
-- -----------------------------------------------------------------------------
create or replace function app.forbid_self_role_escalation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new; -- seed/migração/backend de sistema
  end if;
  if new.id = (select auth.uid())
     and (new.roles is distinct from old.roles
          or new.permissions is distinct from old.permissions) then
    raise exception
      'Um usuário não pode alterar os próprios roles ou permissions'
      using errcode = 'check_violation';
  end if;
  if new.id = (select auth.uid())
     and (new.restaurant_id is distinct from old.restaurant_id
          or new.active is distinct from old.active) then
    raise exception
      'Um usuário não pode alterar o próprio restaurant_id nem se reativar'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger forbid_self_role_escalation
  before update on public.profiles
  for each row execute function app.forbid_self_role_escalation();
