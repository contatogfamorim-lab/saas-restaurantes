-- =============================================================================
-- 0012 — Row Level Security
-- =============================================================================
-- Regra: RLS habilitada em TODAS as tabelas, sem exceção. No Supabase, tabela
-- sem RLS + chave anon = leitura pública pela internet. O script
-- `scripts/check-rls.ts` falha o build se alguma tabela ficar de fora.
--
-- Modelo de chamador (spec §10.0):
--   anon          → só cardápio público do restaurante ativo
--   sessão de mesa→ NENHUM acesso direto. Passa por Route Handler que valida o
--                   cookie assinado e usa service_role no servidor.
--   equipe        → Supabase Auth + roles, sempre escopado por restaurant_id
--
-- service_role IGNORA RLS. Por isso as regras que precisam valer para todo
-- mundo (imutabilidade do audit_log, congelamento de preço do item, máquina de
-- estados) estão em TRIGGER, não em policy.
-- =============================================================================

alter table public.restaurants             enable row level security;
alter table public.profiles                enable row level security;
alter table public.restaurant_tables       enable row level security;
alter table public.categories              enable row level security;
alter table public.products                enable row level security;
alter table public.modifier_groups         enable row level security;
alter table public.modifier_options        enable row level security;
alter table public.product_modifier_groups enable row level security;
alter table public.promotions              enable row level security;
alter table public.promotion_targets       enable row level security;
alter table public.table_sessions          enable row level security;
alter table public.session_guests          enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.order_item_modifiers    enable row level security;
alter table public.waiter_calls            enable row level security;
alter table public.session_adjustments     enable row level security;
alter table public.payments                enable row level security;
alter table public.menu_events             enable row level security;
alter table public.menu_layouts            enable row level security;
alter table public.menu_blocks             enable row level security;
alter table public.audit_log               enable row level security;

-- =============================================================================
-- GRANTs de tabela — a camada ABAIXO da RLS
-- =============================================================================
-- RLS restringe LINHAS, mas só depois que o papel tem o privilégio no objeto.
-- Sem GRANT, a policy nem é avaliada: o Postgres responde "permission denied".
--
-- Não dá para confiar nas default privileges do Supabase. Nesta versão, tabela
-- criada por `postgres` em `public` nasce com `Dxtm` para anon/authenticated
-- (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) — sem SELECT, INSERT nem UPDATE.
-- Configuração do ambiente não pertence a este repositório; então os grants são
-- explícitos, e o CI confere que continuam do tamanho certo.
--
-- DELETE fica de fora de propósito para as tabelas de negócio (spec §10.7:
-- "Nada é deletado"). Só as tabelas de junção e de composição de cardápio
-- recebem DELETE, porque ali remover linha é a operação legítima.
-- =============================================================================
revoke all on all tables in schema public from anon, authenticated;

-- --- anon: SELECT, e SÓ no cardápio público (spec §10.2) ---------------------
grant select on public.restaurants             to anon;
grant select on public.categories              to anon;
grant select on public.products                to anon;
grant select on public.modifier_groups         to anon;
grant select on public.modifier_options        to anon;
grant select on public.product_modifier_groups to anon;

-- --- authenticated: leitura em tudo do próprio restaurante (a RLS filtra) ----
grant select on all tables in schema public to authenticated;

-- --- authenticated: escrita onde a operação existe --------------------------
grant insert, update on
  public.restaurants, public.profiles, public.restaurant_tables,
  public.categories, public.products,
  public.modifier_groups, public.modifier_options, public.product_modifier_groups,
  public.promotions, public.promotion_targets,
  public.table_sessions, public.session_guests,
  public.orders, public.order_items, public.order_item_modifiers,
  public.waiter_calls, public.session_adjustments, public.payments,
  public.menu_layouts, public.menu_blocks
  to authenticated;

grant insert on public.audit_log to authenticated;

-- Remover um bloco do cardápio, desvincular um grupo de modificadores de um
-- prato ou tirar um produto de uma promoção são remoções de verdade — não há
-- histórico a preservar nessas linhas.
grant delete on
  public.product_modifier_groups, public.promotion_targets, public.menu_blocks
  to authenticated;

grant all on all tables in schema public to service_role;

-- =============================================================================
-- Permissões delegadas do cardápio (spec §12.9)
-- =============================================================================
-- Espelha lib/permissions.ts. A duplicação é deliberada — são duas camadas de
-- aplicação — e `tests/permissions.test.ts` garante que as duas concordam.
-- =============================================================================
create or replace function app.has_menu_permission(perm text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    -- concessão explícita do dono
    perm = any(app.current_permissions())
    or case perm
      when 'menu.availability' then
        app.has_any_role('kitchen', 'waiter', 'manager', 'owner')
      when 'menu.content'   then app.has_any_role('manager', 'owner')
      when 'menu.structure' then app.has_any_role('manager', 'owner')
      when 'menu.promotion' then app.has_any_role('manager', 'owner')
      when 'menu.price'     then app.has_role('owner')
      when 'menu.publish'   then app.has_role('owner')
      else false
    end
$$;

-- =============================================================================
-- restaurants
-- =============================================================================
create policy restaurants_public_read on public.restaurants
  for select to anon using (active);

create policy restaurants_staff_read on public.restaurants
  for select to authenticated using (id = app.current_restaurant_id());

create policy restaurants_owner_update on public.restaurants
  for update to authenticated
  using (id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'))
  with check (id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'));

-- =============================================================================
-- profiles — só owner cria/edita equipe. Ninguém edita os próprios roles
-- (garantido pelo trigger forbid_self_role_escalation, que vale até para
-- service_role).
-- =============================================================================
create policy profiles_staff_read on public.profiles
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy profiles_owner_insert on public.profiles
  for insert to authenticated
  with check (restaurant_id = app.current_restaurant_id() and app.has_role('owner'));

create policy profiles_owner_update on public.profiles
  for update to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_role('owner'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_role('owner'));

-- todo funcionário pode manter o próprio PIN e nome — nunca roles/permissions
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- =============================================================================
-- restaurant_tables — SEM leitura anônima.
-- Resolver /m/[short_code] → mesa acontece no servidor. Expor esta tabela ao
-- anon entregaria a lista de short_codes de todas as casas (spec §10.4).
-- =============================================================================
create policy restaurant_tables_staff_read on public.restaurant_tables
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy restaurant_tables_manage on public.restaurant_tables
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'));

-- =============================================================================
-- Cardápio público (spec §10.2), filtrado por disponibilidade e horário
-- =============================================================================
create policy categories_public_read on public.categories
  for select to anon
  using (
    archived_at is null
    and exists (
      select 1 from public.restaurants r
       where r.id = categories.restaurant_id and r.active
         and app.is_within_service_window(
               categories.available_from, categories.available_to,
               categories.days_of_week, r.timezone)
    )
  );

create policy categories_staff_read on public.categories
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy categories_staff_write on public.categories
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.structure'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.structure'));

-- -----------------------------------------------------------------------------
create policy products_public_read on public.products
  for select to anon
  using (
    is_available
    and archived_at is null
    and exists (
      select 1
        from public.categories c
        join public.restaurants r on r.id = c.restaurant_id
       where c.id = products.category_id
         and c.archived_at is null
         and r.active
         and app.is_within_service_window(
               c.available_from, c.available_to, c.days_of_week, r.timezone)
    )
  );

create policy products_staff_read on public.products
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

-- A granularidade fina (preço vs. disponibilidade vs. conteúdo) é por COLUNA,
-- e policy é por LINHA. Quem separa os três é o trigger products_column_guard.
create policy products_staff_write on public.products
  for all to authenticated
  using (
    restaurant_id = app.current_restaurant_id()
    and (app.has_menu_permission('menu.availability')
         or app.has_menu_permission('menu.content')
         or app.has_menu_permission('menu.price'))
  )
  with check (
    restaurant_id = app.current_restaurant_id()
    and (app.has_menu_permission('menu.availability')
         or app.has_menu_permission('menu.content')
         or app.has_menu_permission('menu.price'))
  );

-- -----------------------------------------------------------------------------
create policy modifier_groups_public_read on public.modifier_groups
  for select to anon
  using (
    archived_at is null
    and exists (select 1 from public.restaurants r
                 where r.id = modifier_groups.restaurant_id and r.active)
  );

create policy modifier_groups_staff_read on public.modifier_groups
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy modifier_groups_staff_write on public.modifier_groups
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.content'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.content'));

create policy modifier_options_public_read on public.modifier_options
  for select to anon
  using (
    is_available and archived_at is null
    and exists (select 1 from public.restaurants r
                 where r.id = modifier_options.restaurant_id and r.active)
  );

create policy modifier_options_staff_read on public.modifier_options
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy modifier_options_staff_write on public.modifier_options
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.content'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.content'));

-- Join puro, sem dado sensível. Sem ele o cardápio anônimo não sabe quais
-- grupos se aplicam a cada prato.
create policy product_modifier_groups_public_read on public.product_modifier_groups
  for select to anon
  using (exists (select 1 from public.restaurants r
                  where r.id = product_modifier_groups.restaurant_id and r.active));

create policy product_modifier_groups_staff_read on public.product_modifier_groups
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy product_modifier_groups_staff_write on public.product_modifier_groups
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.content'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.content'));

-- =============================================================================
-- Promoções — sem leitura anônima direta. O cardápio recebe as promoções já
-- resolvidas pelo servidor, junto com o preço final.
-- =============================================================================
create policy promotions_staff_read on public.promotions
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy promotions_staff_write on public.promotions
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.promotion'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.promotion'));

create policy promotion_targets_staff_read on public.promotion_targets
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy promotion_targets_staff_write on public.promotion_targets
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.promotion'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.promotion'));

-- =============================================================================
-- Comanda e pedidos — ZERO acesso anônimo. Só equipe do próprio restaurante.
-- =============================================================================
create policy table_sessions_staff_read on public.table_sessions
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy table_sessions_staff_write on public.table_sessions
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id()
         and app.has_any_role('waiter', 'cashier', 'manager', 'owner'))
  with check (restaurant_id = app.current_restaurant_id()
              and app.has_any_role('waiter', 'cashier', 'manager', 'owner'));

create policy session_guests_staff_read on public.session_guests
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy session_guests_staff_write on public.session_guests
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id()
         and app.has_any_role('waiter', 'cashier', 'manager', 'owner'))
  with check (restaurant_id = app.current_restaurant_id()
              and app.has_any_role('waiter', 'cashier', 'manager', 'owner'));

create policy orders_staff_read on public.orders
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy orders_staff_write on public.orders
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id()
         and app.has_any_role('waiter', 'manager', 'owner'))
  with check (restaurant_id = app.current_restaurant_id()
              and app.has_any_role('waiter', 'manager', 'owner'));

create policy order_items_staff_read on public.order_items
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

-- cozinha entra aqui: é quem move queued → preparing → ready
create policy order_items_staff_write on public.order_items
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id()
         and app.has_any_role('waiter', 'kitchen', 'manager', 'owner'))
  with check (restaurant_id = app.current_restaurant_id()
              and app.has_any_role('waiter', 'kitchen', 'manager', 'owner'));

create policy order_item_modifiers_staff_read on public.order_item_modifiers
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy order_item_modifiers_staff_write on public.order_item_modifiers
  for insert to authenticated
  with check (restaurant_id = app.current_restaurant_id()
              and app.has_any_role('waiter', 'manager', 'owner'));

create policy waiter_calls_staff_read on public.waiter_calls
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy waiter_calls_staff_write on public.waiter_calls
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id())
  with check (restaurant_id = app.current_restaurant_id());

-- =============================================================================
-- Dinheiro (spec §10.3)
-- =============================================================================
create policy session_adjustments_staff_read on public.session_adjustments
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

-- O teto por função (10% para cashier) é valor, não linha: fica em
-- lib/permissions.ts e na Server Action. A policy garante o piso.
create policy session_adjustments_insert on public.session_adjustments
  for insert to authenticated
  with check (restaurant_id = app.current_restaurant_id()
              and app.has_any_role('cashier', 'manager', 'owner')
              and created_by = (select auth.uid()));

create policy payments_staff_read on public.payments
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy payments_insert on public.payments
  for insert to authenticated
  with check (restaurant_id = app.current_restaurant_id()
              and app.has_any_role('cashier', 'manager', 'owner')
              and created_by = (select auth.uid()));

-- =============================================================================
-- menu_events — gravados pelo servidor (service_role) a partir do cardápio do
-- cliente. Leitura só para quem vê o dashboard.
-- =============================================================================
create policy menu_events_owner_read on public.menu_events
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id()
         and app.has_any_role('owner', 'manager'));

-- =============================================================================
-- Editor de cardápio
-- =============================================================================
create policy menu_layouts_staff_read on public.menu_layouts
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy menu_layouts_structure_write on public.menu_layouts
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.structure'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.structure'));

create policy menu_blocks_staff_read on public.menu_blocks
  for select to authenticated using (restaurant_id = app.current_restaurant_id());

create policy menu_blocks_structure_write on public.menu_blocks
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.structure'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_menu_permission('menu.structure'));

-- =============================================================================
-- audit_log — insert e select. NENHUMA policy de update ou delete, de propósito.
-- Sem policy, a operação é negada. Os triggers de 0010 fecham o cerco para
-- service_role.
-- =============================================================================
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (restaurant_id = app.current_restaurant_id());

create policy audit_log_read on public.audit_log
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id()
         and app.has_any_role('owner', 'manager'));

-- =============================================================================
-- Guarda de coluna em products (spec §12.9 e critério de aceite:
-- "funcionário sem menu.price não consegue alterar preço por nenhum caminho")
-- =============================================================================
-- Policy é por linha; esta separação é por coluna. Como trigger, vale também
-- para Server Action, Route Handler autenticado e SQL direto.
--
-- LIMITE CONHECIDO: auth.uid() é nulo sob service_role (seed, migração, job).
-- Por isso as mutações do editor de cardápio DEVEM usar o client autenticado
-- do funcionário, nunca service_role.
-- =============================================================================
create or replace function app.products_column_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;  -- seed / migração / job do sistema
  end if;

  if new.price_cents is distinct from old.price_cents
     and not app.has_menu_permission('menu.price') then
    raise exception 'Sem permissão menu.price para alterar o preço de "%"', old.name
      using errcode = 'insufficient_privilege';
  end if;

  if new.is_available is distinct from old.is_available
     and not app.has_menu_permission('menu.availability') then
    raise exception 'Sem permissão menu.availability para alterar a disponibilidade de "%"', old.name
      using errcode = 'insufficient_privilege';
  end if;

  if (new.name is distinct from old.name
      or new.description is distinct from old.description
      or new.image_url is distinct from old.image_url)
     and not app.has_menu_permission('menu.content') then
    raise exception 'Sem permissão menu.content para editar "%"', old.name
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger products_column_guard
  before update on public.products
  for each row execute function app.products_column_guard();

-- -----------------------------------------------------------------------------
-- Toda alteração de preço vai para audit_log com valor anterior e novo.
-- Trigger, não chamada da aplicação: assim não existe caminho que escape.
-- -----------------------------------------------------------------------------
create or replace function app.audit_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price_cents is distinct from old.price_cents then
    insert into public.audit_log (
      restaurant_id, actor_type, actor_id, action, entity_type, entity_id,
      before, after
    ) values (
      new.restaurant_id,
      -- cast explícito: um CASE com dois literais resolve para `text`, e o
      -- Postgres não converte text para enum implicitamente
      (case when (select auth.uid()) is null then 'system' else 'staff' end)
        ::public.audit_actor_type,
      (select auth.uid()),
      'product.price_changed',
      'products',
      new.id,
      jsonb_build_object('price_cents', old.price_cents, 'name', old.name),
      jsonb_build_object('price_cents', new.price_cents, 'name', new.name)
    );
  end if;
  return new;
end;
$$;

create trigger audit_product_price_change
  after update of price_cents on public.products
  for each row execute function app.audit_product_price_change();

-- =============================================================================
-- Privilégios sobre o schema `app`
-- =============================================================================
-- Duas armadilhas do Postgres se cruzam aqui:
--
-- 1. EXECUTE em função nova é concedido a PUBLIC por padrão. Só criar as
--    funções no schema `app` não as protege.
-- 2. Uma policy é avaliada com os privilégios de QUEM consulta. Se `anon` não
--    puder executar `app.is_within_service_window`, a policy do cardápio
--    público falha com "permission denied for schema app" — e o cardápio,
--    que é a razão de existir do produto, não abre.
--
-- Então: tira tudo de PUBLIC e devolve nominalmente, função a função.
-- Funções de TRIGGER ficam de fora de propósito — o Postgres não checa
-- privilégio de execução ao disparar trigger, e concedê-las só ampliaria a
-- superfície.
-- =============================================================================
revoke all on all functions in schema app from public, anon, authenticated;
grant usage on schema app to anon, authenticated, service_role;

-- o cardápio público precisa saber se a categoria está no horário
grant execute on function app.is_within_service_window(time, time, int[], text, timestamptz)
  to anon, authenticated, service_role;

-- helpers de autorização: só para quem está logado
grant execute on function app.current_restaurant_id()      to authenticated, service_role;
grant execute on function app.current_roles()              to authenticated, service_role;
grant execute on function app.current_permissions()        to authenticated, service_role;
grant execute on function app.has_role(text)               to authenticated, service_role;
grant execute on function app.has_any_role(text[])         to authenticated, service_role;
grant execute on function app.is_staff_of(uuid)            to authenticated, service_role;
grant execute on function app.has_menu_permission(text)    to authenticated, service_role;
grant execute on function app.promotion_is_live(public.promotions, text, timestamptz)
  to authenticated, service_role;

-- DEFAULT de restaurant_tables.short_code: quem insere a mesa precisa executar
grant execute on function app.generate_short_code(int) to authenticated, service_role;

-- Reserva de estoque de promoção: SÓ service_role.
-- Ela decrementa estoque de forma irreversível dentro da transação. Fica
-- restrita à camada única de comandos do servidor (spec §13.7) — nenhum
-- funcionário logado consegue queimar estoque de promoção com uma chamada solta.
grant execute on function app.claim_promotion_quantity(uuid, int) to service_role;
