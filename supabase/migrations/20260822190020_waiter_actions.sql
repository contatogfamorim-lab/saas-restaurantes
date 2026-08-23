-- =============================================================================
-- 0020 — Ações do garçom (spec §5)
-- =============================================================================
-- Todas SECURITY INVOKER, de propósito: rodam com a identidade do funcionário,
-- então a RLS e os guardas de coluna continuam valendo. Uma função SECURITY
-- DEFINER aqui desligaria justamente a camada que impede um garçom de mexer na
-- comanda de outro restaurante.
--
-- SQLSTATEs:
--   45020 pedido não está aguardando aprovação
--   45021 item não pertence ao pedido
--   45022 recusa sem motivo
--   45023 mesa com itens na cozinha
--   45024 saldo em aberto exige liberação forçada
--   45025 liberação forçada sem motivo
--   45026 sem permissão
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Máquina de estados: 'held' entra entre pending e queued
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
    when 'pending'      then array['held', 'queued', 'cancelled', 'out_of_stock']
    -- retido pela marcha: só pode ser liberado para a cozinha ou cancelado
    when 'held'         then array['queued', 'cancelled', 'out_of_stock']
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
  -- `queued_at` é carimbado na LIBERAÇÃO, não na aprovação: é aí que a cozinha
  -- assume o item, e é de lá que o cronômetro tem que contar.
  case new.status
    when 'queued'    then new.queued_at    := coalesce(new.queued_at, now());
    when 'preparing' then new.started_at   := coalesce(new.started_at, now());
    when 'ready'     then new.ready_at     := coalesce(new.ready_at, now());
    when 'delivered' then new.delivered_at := coalesce(new.delivered_at, now());
    else null;
  end case;

  if new.status in ('cancelled', 'out_of_stock') and new.rejection_reason is null
     and old.status in ('pending', 'held') then
    raise exception 'Recusa de item exige rejection_reason'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- =============================================================================
-- approve_order — a fila de aprovação (spec §5)
-- =============================================================================
-- Aprova e recusa NUMA SÓ transação. Separado em duas chamadas, uma falha no
-- meio deixaria metade do pedido aprovado e metade em limbo, com o cliente
-- vendo um estado que ninguém escolheu.
--
-- `p_recusas`: [{ item_id, reason, mark_out_of_stock }]
-- `p_reter_cursos`: cursos que ficam retidos pela marcha (ex.: [2,3])
-- =============================================================================
create or replace function public.approve_order(
  p_order_id      uuid,
  p_aprovados     uuid[],
  p_recusas       jsonb default '[]'::jsonb,
  p_reter_cursos  int[] default '{}'::int[]
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order        record;
  v_recusa       jsonb;
  v_item         record;
  v_aprovados    int := 0;
  v_recusados    int := 0;
  v_pendentes    int;
  v_novo_status  public.order_status;
begin
  if not app.has_any_role('waiter', 'manager', 'owner') then
    raise exception 'Sem permissão para aprovar pedidos' using errcode = '45026';
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado' using errcode = '45020';
  end if;
  if v_order.status <> 'pending_approval' then
    raise exception 'Este pedido já foi conferido' using errcode = '45020';
  end if;

  -- --- recusas ---------------------------------------------------------------
  for v_recusa in select value from jsonb_array_elements(p_recusas) loop
    select oi.* into v_item
    from public.order_items oi
    where oi.id = (v_recusa ->> 'item_id')::uuid
      and oi.order_id = p_order_id;

    if not found then
      raise exception 'Item não pertence a este pedido' using errcode = '45021';
    end if;

    if coalesce(v_recusa ->> 'reason', '') = '' then
      raise exception 'Recusa exige motivo' using errcode = '45022';
    end if;

    update public.order_items
       set rejection_reason = (v_recusa ->> 'reason')::public.rejection_reason,
           -- "acabou" vira out_of_stock; o resto é cancelamento comum. A
           -- distinção alimenta o ranking de rupturas no dashboard (spec §8).
           status = case when (v_recusa ->> 'reason') = 'acabou'
                         then 'out_of_stock'::public.order_item_status
                         else 'cancelled'::public.order_item_status end
     where id = v_item.id;

    v_recusados := v_recusados + 1;

    -- "Marcar como esgotado no cardápio?" (spec §5): some de todos os celulares
    if coalesce((v_recusa ->> 'mark_out_of_stock')::boolean, false) then
      update public.products
         set is_available = false
       where id = v_item.product_id;
    end if;

    insert into public.audit_log
      (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, before, after)
    values
      (v_order.restaurant_id, 'staff', (select auth.uid()),
       'order_item.rejected', 'order_items', v_item.id,
       jsonb_build_object('status', v_item.status),
       jsonb_build_object('reason', v_recusa ->> 'reason',
                          'marked_out_of_stock',
                          coalesce((v_recusa ->> 'mark_out_of_stock')::boolean, false)));
  end loop;

  -- --- aprovações ------------------------------------------------------------
  for v_item in
    select oi.* from public.order_items oi
    where oi.order_id = p_order_id
      and oi.status = 'pending'
      and oi.id = any(coalesce(p_aprovados, '{}'::uuid[]))
  loop
    update public.order_items
       set status = case when v_item.course = any(coalesce(p_reter_cursos, '{}'::int[]))
                         -- marcha: fica retido, e o relógio da cozinha só
                         -- começa quando o garçom liberar o curso
                         then 'held'::public.order_item_status
                         else 'queued'::public.order_item_status end
     where id = v_item.id;

    v_aprovados := v_aprovados + 1;
  end loop;

  -- --- estado do pedido ------------------------------------------------------
  select count(*) into v_pendentes
  from public.order_items
  where order_id = p_order_id and status = 'pending';

  v_novo_status := case
    when v_aprovados = 0 then 'rejected'
    when v_recusados > 0 or v_pendentes > 0 then 'partially_approved'
    else 'approved'
  end;

  update public.orders
     set status = v_novo_status,
         approved_by = (select auth.uid()),
         approved_at = now()
   where id = p_order_id;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, before, after)
  values
    (v_order.restaurant_id, 'staff', (select auth.uid()),
     'order.approved', 'orders', p_order_id,
     jsonb_build_object('status', 'pending_approval'),
     jsonb_build_object('status', v_novo_status,
                        'aprovados', v_aprovados, 'recusados', v_recusados));

  return jsonb_build_object(
    'status', v_novo_status,
    'aprovados', v_aprovados,
    'recusados', v_recusados
  );
end;
$$;

-- =============================================================================
-- release_course — "Liberar principais" (spec §5)
-- =============================================================================
create or replace function public.release_course(
  p_session_id uuid,
  p_course     int
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_liberados int;
begin
  if not app.has_any_role('waiter', 'manager', 'owner') then
    raise exception 'Sem permissão para liberar a marcha' using errcode = '45026';
  end if;

  with liberados as (
    update public.order_items oi
       set status = 'queued'
      from public.orders o
     where o.id = oi.order_id
       and o.session_id = p_session_id
       and oi.course = p_course
       and oi.status = 'held'
    returning oi.id
  )
  select count(*)::int into v_liberados from liberados;

  return v_liberados;
end;
$$;

-- =============================================================================
-- release_table — liberar mesa (spec §5)
-- =============================================================================
-- A MESMA função para a tela do garçom e a do caixa. Em casa pequena é a mesma
-- pessoa, e duplicar a lógica garantiria que as duas telas divergissem — uma
-- delas deixando passar o que a outra bloqueia.
-- =============================================================================
create or replace function public.release_table(
  p_session_id uuid,
  p_forcada    boolean default false,
  p_motivo     public.release_reason default null,
  p_observacao text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sessao   record;
  v_saldo    int;
  v_producao int;
begin
  select s.* into v_sessao
  from public.table_sessions s
  where s.id = p_session_id and s.status in ('open', 'closing')
  for update;

  if not found then
    raise exception 'Esta comanda não está aberta' using errcode = '45020';
  end if;

  select coalesce(st.balance_cents, 0) into v_saldo
  from public.session_totals st where st.session_id = p_session_id;

  -- Itens na cozinha: bloqueia e exige confirmação explícita (spec §5). Liberar
  -- a mesa com prato sendo feito significa comida pronta sem destino.
  select count(*)::int into v_producao
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.session_id = p_session_id
    and oi.status in ('queued', 'preparing', 'held');

  if v_producao > 0 and not p_forcada then
    raise exception 'Há % item(ns) na cozinha', v_producao
      using errcode = '45023',
            detail = v_producao::text;
  end if;

  -- Saldo em aberto → liberação forçada, que é privilégio de gestor
  if v_saldo > 0 then
    if not p_forcada then
      raise exception 'Comanda com saldo de % centavos', v_saldo
        using errcode = '45024', detail = v_saldo::text;
    end if;
    if not app.has_any_role('manager', 'owner') then
      raise exception 'Só gerente ou dono libera mesa com saldo em aberto'
        using errcode = '45026';
    end if;
  elsif not app.has_any_role('waiter', 'cashier', 'manager', 'owner') then
    raise exception 'Sem permissão para liberar mesa' using errcode = '45026';
  end if;

  if p_forcada and p_motivo is null then
    raise exception 'Liberação forçada exige motivo' using errcode = '45025';
  end if;

  -- o que sobrou na cozinha é cancelado junto, com rastro
  update public.order_items oi
     set status = 'cancelled', rejection_reason = 'erro_no_pedido'
    from public.orders o
   where o.id = oi.order_id
     and o.session_id = p_session_id
     and oi.status in ('pending', 'held', 'queued', 'preparing');

  update public.table_sessions
     set status = 'closed',
         closed_at = now(),
         force_released = p_forcada,
         released_by = (select auth.uid()),
         released_at = now(),
         release_reason = p_motivo,
         release_note = p_observacao
   where id = p_session_id;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, before, after)
  values
    (v_sessao.restaurant_id, 'staff', (select auth.uid()),
     case when p_forcada then 'table.force_released' else 'table.released' end,
     'table_sessions', p_session_id,
     jsonb_build_object('status', v_sessao.status, 'saldo_cents', v_saldo),
     jsonb_build_object('forcada', p_forcada, 'motivo', p_motivo,
                        'observacao', p_observacao,
                        'itens_cancelados', v_producao));

  return jsonb_build_object('saldo_cents', v_saldo, 'itens_cancelados', v_producao);
end;
$$;

-- =============================================================================
-- Entrega do item (spec §5) — o garçom fecha o ciclo
-- =============================================================================
create or replace function public.mark_item_delivered(p_item_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.has_any_role('waiter', 'manager', 'owner') then
    raise exception 'Sem permissão' using errcode = '45026';
  end if;

  update public.order_items
     set status = 'delivered'
   where id = p_item_id and status = 'ready';

  if not found then
    raise exception 'Item não está pronto para entrega' using errcode = '45020';
  end if;
end;
$$;

-- =============================================================================
-- Chamados de mesa resolvidos (spec §5)
-- =============================================================================
create or replace function public.resolve_waiter_call(p_call_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.waiter_calls
     set status = 'resolved', resolved_at = now(), resolved_by = (select auth.uid())
   where id = p_call_id and status = 'open';
end;
$$;

-- -----------------------------------------------------------------------------
-- Só equipe autenticada. Nunca anon — nenhuma destas funções tem qualquer
-- motivo para ser alcançável pelo celular do cliente.
-- -----------------------------------------------------------------------------
revoke all on function public.approve_order(uuid, uuid[], jsonb, int[]) from public, anon;
revoke all on function public.release_course(uuid, int) from public, anon;
revoke all on function public.release_table(uuid, boolean, public.release_reason, text) from public, anon;
revoke all on function public.mark_item_delivered(uuid) from public, anon;
revoke all on function public.resolve_waiter_call(uuid) from public, anon;

grant execute on function public.approve_order(uuid, uuid[], jsonb, int[]) to authenticated, service_role;
grant execute on function public.release_course(uuid, int) to authenticated, service_role;
grant execute on function public.release_table(uuid, boolean, public.release_reason, text) to authenticated, service_role;
grant execute on function public.mark_item_delivered(uuid) to authenticated, service_role;
grant execute on function public.resolve_waiter_call(uuid) to authenticated, service_role;
