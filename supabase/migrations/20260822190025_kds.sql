-- =============================================================================
-- 0025 — Ações da cozinha (spec §6)
-- =============================================================================
-- Iniciar, marcar pronto e avisar que acabou.
--
-- SECURITY INVOKER, como as ações do garçom: rodam com a identidade de quem
-- está no tablet, então RLS e guardas de coluna continuam valendo.
--
-- SQLSTATEs:
--   45030 item não está no estado esperado
--   45031 sem permissão
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A máquina de estados não permitia queued/preparing → out_of_stock.
--
-- Era lacuna real: o botão "Acabou" da §6 é acionado com o item JÁ na fila da
-- cozinha — é lá que se descobre que o polvo acabou, não antes. Sem esta
-- transição, o botão existiria na tela e falharia no banco.
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
    -- retido pela marcha: só pode ser liberado para a cozinha ou recusado
    when 'held'         then array['queued', 'cancelled', 'out_of_stock']
    -- a cozinha descobre a ruptura AQUI, com o item na fila
    when 'queued'       then array['preparing', 'cancelled', 'out_of_stock']
    when 'preparing'    then array['ready', 'cancelled', 'out_of_stock']
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

  -- Recusa e ruptura exigem motivo, venham de onde vierem.
  if new.status in ('cancelled', 'out_of_stock') and new.rejection_reason is null then
    raise exception 'Recusar ou dar baixa em item exige rejection_reason'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- =============================================================================
create or replace function public.kds_start_item(p_item_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.has_any_role('kitchen', 'manager', 'owner') then
    raise exception 'Sem permissão' using errcode = '45031';
  end if;

  update public.order_items set status = 'preparing'
   where id = p_item_id and status = 'queued';

  if not found then
    raise exception 'Este item não está na fila' using errcode = '45030';
  end if;
end;
$$;

create or replace function public.kds_item_ready(p_item_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.has_any_role('kitchen', 'manager', 'owner') then
    raise exception 'Sem permissão' using errcode = '45031';
  end if;

  update public.order_items set status = 'ready'
   where id = p_item_id and status = 'preparing';

  if not found then
    raise exception 'Este item não está em preparo' using errcode = '45030';
  end if;
end;
$$;

/**
 * "Acabou" (spec §6).
 *
 * Três efeitos numa transação só:
 *   1. o item sai da fila como out_of_stock;
 *   2. o produto some do cardápio de TODOS os celulares da casa;
 *   3. fica registro de quem deu a baixa.
 *
 * O passo 2 é opcional porque nem toda ruptura é do produto: às vezes acabou o
 * acompanhamento daquele prato específico, e sumir com o item inteiro do
 * cardápio seria perder venda por excesso de zelo.
 */
create or replace function public.kds_out_of_stock(
  p_item_id             uuid,
  p_marcar_indisponivel boolean default true
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
begin
  if not app.has_any_role('kitchen', 'manager', 'owner') then
    raise exception 'Sem permissão' using errcode = '45031';
  end if;

  select oi.*, p.name as produto
  into v_item
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.id = p_item_id
    and oi.status in ('queued', 'preparing');

  if not found then
    raise exception 'Este item não está em produção' using errcode = '45030';
  end if;

  update public.order_items
     set rejection_reason = 'acabou', status = 'out_of_stock'
   where id = p_item_id;

  if p_marcar_indisponivel then
    -- exige menu.availability, que a cozinha tem por padrão (spec §12.9) — é a
    -- mesma ação do "marcar esgotado" do garçom
    update public.products set is_available = false where id = v_item.product_id;
  end if;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, before, after)
  values
    (v_item.restaurant_id, 'staff', (select auth.uid()),
     'kds.out_of_stock', 'order_items', p_item_id,
     jsonb_build_object('status', v_item.status),
     jsonb_build_object('produto', v_item.produto,
                        'removido_do_cardapio', p_marcar_indisponivel));

  return jsonb_build_object(
    'produto', v_item.produto,
    'removido_do_cardapio', p_marcar_indisponivel
  );
end;
$$;

revoke all on function public.kds_start_item(uuid) from public, anon;
revoke all on function public.kds_item_ready(uuid) from public, anon;
revoke all on function public.kds_out_of_stock(uuid, boolean) from public, anon;

grant execute on function public.kds_start_item(uuid) to authenticated, service_role;
grant execute on function public.kds_item_ready(uuid) to authenticated, service_role;
grant execute on function public.kds_out_of_stock(uuid, boolean) to authenticated, service_role;

-- =============================================================================
-- Fila da cozinha, pronta para a tela (spec §6)
-- =============================================================================
-- Ordenada por tempo na fila, mais antigo no topo. SEMPRE — a §6 é explícita, e
-- é a única ordenação que impede um prato de envelhecer no fim da lista.
-- =============================================================================
create view public.kitchen_queue
with (security_invoker = on) as
select
  oi.id                as item_id,
  oi.restaurant_id,
  oi.station,
  oi.status,
  oi.qty,
  oi.notes,
  oi.course,
  oi.queued_at,
  oi.started_at,
  p.name               as produto,
  p.prep_minutes,
  t.label              as mesa,
  g.display_name       as cliente,
  o.session_id,
  -- Do SERVIDOR, não do relógio do tablet: aparelho de cozinha erra a hora, e
  -- um cronômetro adiantado faz a equipe correr atrás de atraso que não existe.
  extract(epoch from (now() - oi.queued_at))::int as na_fila_segundos,
  extract(epoch from (now() - oi.started_at))::int as em_preparo_segundos
from public.order_items oi
join public.orders o             on o.id = oi.order_id
join public.products p           on p.id = oi.product_id
join public.table_sessions s     on s.id = o.session_id
join public.restaurant_tables t  on t.id = s.table_id
left join public.session_guests g on g.id = oi.guest_id
where oi.status in ('queued', 'preparing', 'ready');

grant select on public.kitchen_queue to authenticated, service_role;

comment on view public.kitchen_queue is
  'Fila de produção por estação. Só queued/preparing/ready — item retido pela '
  'marcha (held) NÃO aparece: para a cozinha, ele ainda não existe.';
