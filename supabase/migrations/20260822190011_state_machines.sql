-- =============================================================================
-- 0010 — Máquinas de estado e integridade financeira, validadas NO BANCO
-- =============================================================================
-- Spec §3 e §10.7: transição inválida tem que ser erro do Postgres, não só da
-- API. A API valida para dar mensagem boa; o banco valida para ser verdade.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- order_items
--   pending ──(garçom aprova)──> queued ──(cozinha inicia)──> preparing
--   preparing ──(pronto)──> ready ──(garçom entrega)──> delivered
--   pending ──(garçom recusa)──> cancelled | out_of_stock
-- -----------------------------------------------------------------------------
create or replace function app.order_item_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'pending'      then array['queued', 'cancelled', 'out_of_stock']
    when 'queued'       then array['preparing', 'cancelled']
    when 'preparing'    then array['ready', 'cancelled']
    when 'ready'        then array['delivered', 'cancelled']
    else array[]::text[]   -- delivered, cancelled, out_of_stock são terminais
  end;

  if not (new.status::text = any(allowed)) then
    raise exception 'Transição inválida em order_items: % -> %', old.status, new.status
      using errcode = 'check_violation',
            hint = 'Estados válidos a partir de ' || old.status || ': ' ||
                   coalesce(array_to_string(allowed, ', '), 'nenhum (terminal)');
  end if;

  -- Os timestamps são consequência da transição, nunca entrada da API.
  -- É daqui que saem fila_seconds, producao_seconds e total_seconds.
  case new.status
    when 'queued'    then new.queued_at    := coalesce(new.queued_at, now());
    when 'preparing' then new.started_at   := coalesce(new.started_at, now());
    when 'ready'     then new.ready_at     := coalesce(new.ready_at, now());
    when 'delivered' then new.delivered_at := coalesce(new.delivered_at, now());
    else null;
  end case;

  if new.status in ('cancelled', 'out_of_stock') and new.rejection_reason is null
     and old.status = 'pending' then
    raise exception 'Recusa de item exige rejection_reason'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger order_item_transition
  before update of status on public.order_items
  for each row execute function app.order_item_transition();

-- item nasce em 'pending' e só o garçom o move dali
create or replace function app.order_item_starts_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'pending' then
    raise exception 'order_item precisa nascer em pending — nada vai para a '
                    'cozinha sem aprovação do garçom (spec §16)'
      using errcode = 'check_violation';
  end if;
  if new.queued_at is not null or new.started_at is not null
     or new.ready_at is not null or new.delivered_at is not null then
    raise exception 'Timestamps de produção são definidos pelas transições, '
                    'nunca no INSERT'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger order_item_starts_pending
  before insert on public.order_items
  for each row execute function app.order_item_starts_pending();

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
create or replace function app.order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'pending_approval' then
      array['approved', 'partially_approved', 'rejected', 'cancelled']
    when 'approved'           then array['cancelled']
    when 'partially_approved' then array['cancelled']
    else array[]::text[]
  end;

  if not (new.status::text = any(allowed)) then
    raise exception 'Transição inválida em orders: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status in ('approved', 'partially_approved') then
    new.approved_at := coalesce(new.approved_at, now());
  end if;

  return new;
end;
$$;

create trigger order_transition
  before update of status on public.orders
  for each row execute function app.order_transition();

-- -----------------------------------------------------------------------------
-- table_sessions
-- -----------------------------------------------------------------------------
create or replace function app.session_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'open'    then array['closing', 'closed', 'cancelled']
    when 'closing' then array['open', 'closed', 'cancelled']
    else array[]::text[]
  end;

  if not (new.status::text = any(allowed)) then
    raise exception 'Transição inválida em table_sessions: % -> %',
                    old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status in ('closed', 'cancelled') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

create trigger session_transition
  before update of status on public.table_sessions
  for each row execute function app.session_transition();

-- =============================================================================
-- Integridade do valor do item
-- =============================================================================
-- total_price_cents = (unit_price_cents + Σ modificadores) × qty
--
-- Constraint trigger DEFERRABLE: o item entra antes dos seus modificadores,
-- então a checagem só fecha no COMMIT. Pega erro de cálculo da aplicação
-- antes de virar comanda errada.
-- =============================================================================
create or replace function app.assert_order_item_total()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item_id  uuid;
  v_item     public.order_items;
  v_mod_sum  int;
  v_expected int;
begin
  if tg_table_name = 'order_items' then
    v_item_id := new.id;
  elsif tg_op = 'DELETE' then
    v_item_id := old.order_item_id;
  else
    v_item_id := new.order_item_id;
  end if;

  select * into v_item from public.order_items where id = v_item_id;
  if not found then
    return null;  -- item removido em cascata: nada a validar
  end if;

  select coalesce(sum(price_delta_cents), 0) into v_mod_sum
    from public.order_item_modifiers
   where order_item_id = v_item_id;

  v_expected := (v_item.unit_price_cents + v_mod_sum) * v_item.qty;

  if v_item.total_price_cents <> v_expected then
    raise exception
      'total_price_cents inconsistente no item %: gravado %, esperado % '
      '((% + %) × %)',
      v_item_id, v_item.total_price_cents, v_expected,
      v_item.unit_price_cents, v_mod_sum, v_item.qty
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger assert_order_item_total
  after insert or update on public.order_items
  deferrable initially deferred
  for each row execute function app.assert_order_item_total();

create constraint trigger assert_order_item_total_from_modifiers
  after insert or update or delete on public.order_item_modifiers
  deferrable initially deferred
  for each row execute function app.assert_order_item_total();

-- =============================================================================
-- Snapshot de preço: item de comanda não se reescreve
-- =============================================================================
-- Regra 1 da spec §3. Mudar o preço do produto amanhã não pode alterar a conta
-- de hoje — e ninguém pode "corrigir" o valor de um item já lançado.
-- =============================================================================
create or replace function app.order_item_price_is_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit_price_cents is distinct from old.unit_price_cents
     or new.total_price_cents is distinct from old.total_price_cents
     or new.original_price_cents is distinct from old.original_price_cents
     or new.promotion_id is distinct from old.promotion_id
     or new.product_id is distinct from old.product_id
     or new.qty is distinct from old.qty then
    raise exception
      'Valores de um item lançado são imutáveis. Cancele o item e lance outro.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger order_item_price_is_frozen
  before update on public.order_items
  for each row execute function app.order_item_price_is_frozen();

create or replace function app.order_item_modifier_is_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Modificadores são snapshot imutável do momento do pedido'
    using errcode = 'check_violation';
end;
$$;

create trigger order_item_modifier_is_frozen
  before update on public.order_item_modifiers
  for each row execute function app.order_item_modifier_is_frozen();
