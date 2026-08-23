-- =============================================================================
-- 0017 — create_guest_order: o pedido do cliente, validado e precificado no banco
-- =============================================================================
-- Regra de ouro da spec §10.1: o servidor NUNCA confia no cliente.
--
-- O cliente manda apenas product_id, qty, modifier_option_ids[], notes e
-- guest_id. Nada além disso — e mesmo isso é reconferido aqui. Nenhum valor
-- monetário entra: os preços saem de product_effective_prices, e os
-- modificadores de modifier_options. Se um valor em centavos aparecesse na
-- entrada desta função, o desenho estaria errado.
--
-- Tudo em UMA função por dois motivos:
--  1. Atomicidade. Pedido, itens, modificadores e a baixa de estoque de
--     promoção precisam existir juntos ou não existir. Com chamadas separadas
--     pelo supabase-js, uma falha no meio deixaria comanda pela metade.
--  2. Concorrência. A trava na sessão e a reserva atômica da promoção só valem
--     dentro da mesma transação.
--
-- SQLSTATEs personalizados (classe 45, reservada a aplicação) para que o Route
-- Handler traduza cada falha numa mensagem útil em vez de "erro interno":
--   45001 sessão não está aberta      45005 grupo obrigatório não satisfeito
--   45002 convidado inválido          45006 quantidade inválida
--   45003 produto indisponível        45007 promoção esgotada
--   45004 modificador inválido        45008 pedido vazio
--                                     45009 pedidos demais em sequência
-- =============================================================================

create or replace function public.create_guest_order(
  p_session_id      uuid,
  p_guest_id        uuid,
  p_idempotency_key text,
  p_items           jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid;
  v_order_id      uuid;
  v_item          jsonb;
  v_product       record;
  v_price         record;
  v_group         record;
  v_qty_num       numeric;
  v_qty           int;
  v_notes         text;
  v_eater         uuid;
  v_option_ids    uuid[];
  v_chosen        int;
  v_mod_sum       int;
  v_item_id       uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Sessão. FOR UPDATE serializa dois envios simultâneos da mesma mesa —
  -- dois celulares tocando "enviar" no mesmo instante é o caso comum, não o raro.
  -- ---------------------------------------------------------------------------
  select s.restaurant_id into v_restaurant_id
  from public.table_sessions s
  where s.id = p_session_id and s.status = 'open'
  for update;

  if v_restaurant_id is null then
    raise exception 'A comanda desta mesa não está aberta'
      using errcode = '45001';
  end if;

  if not exists (
    select 1 from public.session_guests g
    where g.id = p_guest_id and g.session_id = p_session_id
  ) then
    raise exception 'Cliente não pertence a esta mesa' using errcode = '45002';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Pedido sem itens' using errcode = '45008';
  end if;

  if jsonb_array_length(p_items) > 40 then
    raise exception 'Pedido com itens demais' using errcode = '45006';
  end if;

  -- ---------------------------------------------------------------------------
  -- Freio por sessão (spec §10.6, parcial).
  --
  -- Uma mesa manda rodadas, não rajadas: 6 pedidos por minuto já é generoso
  -- para quatro pessoas pedindo junto. Sem isto, um script enche a fila da
  -- cozinha numa noite de sábado e o serviço para.
  --
  -- Fica AQUI, no banco, e não no Route Handler, porque contador em memória de
  -- processo não sobrevive a múltiplas instâncias. O rate limiting completo
  -- (por IP, login e PIN) continua pendente para a Etapa 12.
  -- ---------------------------------------------------------------------------
  if (
    select count(*) from public.orders o
    where o.session_id = p_session_id
      and o.created_at > now() - interval '1 minute'
  ) >= 6 then
    raise exception 'Muitos pedidos seguidos. Aguarde um instante.'
      using errcode = '45009';
  end if;

  -- ---------------------------------------------------------------------------
  -- Idempotência (spec §13.7): repetir o mesmo comando devolve o MESMO pedido,
  -- não cria outro. É o que impede duplicar comanda quando a rede do
  -- restaurante oscila e o celular reenvia.
  -- ---------------------------------------------------------------------------
  select o.id into v_order_id
  from public.orders o
  where o.restaurant_id = v_restaurant_id
    and o.idempotency_key = p_idempotency_key;

  if v_order_id is not null then
    return v_order_id;
  end if;

  insert into public.orders
    (restaurant_id, session_id, guest_id, source, idempotency_key)
  values
    (v_restaurant_id, p_session_id, p_guest_id, 'guest', p_idempotency_key)
  returning id into v_order_id;

  -- ---------------------------------------------------------------------------
  for v_item in select value from jsonb_array_elements(p_items) loop

    -- --- quantidade: inteiro entre 1 e 20 -----------------------------------
    -- Checa o TIPO antes de converter: '1.5'::int e 'abc'::int estourariam com
    -- erro de cast, e o cliente receberia "erro interno" em vez da causa.
    if jsonb_typeof(v_item -> 'qty') <> 'number' then
      raise exception 'Quantidade inválida' using errcode = '45006';
    end if;

    v_qty_num := (v_item ->> 'qty')::numeric;
    if v_qty_num <> floor(v_qty_num) or v_qty_num < 1 or v_qty_num > 20 then
      raise exception 'Quantidade precisa ser um número inteiro de 1 a 20'
        using errcode = '45006';
    end if;
    v_qty := v_qty_num::int;

    -- --- produto: do restaurante, disponível, e categoria dentro do horário --
    select p.id, p.name, p.station_override, c.station as cat_station
    into v_product
    from public.products p
    join public.categories c  on c.id = p.category_id
    join public.restaurants r on r.id = p.restaurant_id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.restaurant_id = v_restaurant_id
      and p.is_available
      and p.archived_at is null
      and c.archived_at is null
      and app.is_within_service_window(
            c.available_from, c.available_to, c.days_of_week, r.timezone);

    if not found then
      raise exception 'Este item não está disponível agora'
        using errcode = '45003';
    end if;

    -- --- preço: da FONTE ÚNICA, nunca do cliente ----------------------------
    select * into v_price
    from public.product_effective_prices
    where product_id = v_product.id;

    -- --- promoção com estoque: reserva atômica ------------------------------
    -- Falha em vez de cobrar o preço cheio calado. O cliente viu "R$ 39" e
    -- "últimas unidades"; cobrar R$ 52 sem avisar quebraria a regra da spec §4
    -- de que o preço exibido é o preço cobrado.
    if v_price.promotion_id is not null and v_price.max_quantity is not null then
      if not app.claim_promotion_quantity(v_price.promotion_id, v_qty) then
        raise exception 'A promoção de % acabou agora', v_product.name
          using errcode = '45007';
      end if;
    end if;

    -- --- modificadores ------------------------------------------------------
    v_option_ids := coalesce((
      select array_agg(value::uuid)
      from jsonb_array_elements_text(coalesce(v_item -> 'modifier_option_ids', '[]'::jsonb))
    ), '{}'::uuid[]);

    -- toda opção precisa pertencer a um grupo DESTE produto e estar disponível
    if exists (
      select 1 from unnest(v_option_ids) as oid
      where not exists (
        select 1
        from public.modifier_options mo
        join public.product_modifier_groups pmg on pmg.group_id = mo.group_id
        where mo.id = oid
          and mo.restaurant_id = v_restaurant_id
          and mo.is_available
          and mo.archived_at is null
          and pmg.product_id = v_product.id
      )
    ) then
      raise exception 'Opção inválida para %', v_product.name
        using errcode = '45004';
    end if;

    -- min_select / max_select / is_required, grupo a grupo
    for v_group in
      select mg.id, mg.name, mg.min_select, mg.max_select, mg.is_required
      from public.modifier_groups mg
      join public.product_modifier_groups pmg on pmg.group_id = mg.id
      where pmg.product_id = v_product.id and mg.archived_at is null
    loop
      select count(*) into v_chosen
      from public.modifier_options mo
      where mo.group_id = v_group.id and mo.id = any(v_option_ids);

      if v_group.is_required and v_chosen = 0 then
        raise exception 'Escolha % em %', lower(v_group.name), v_product.name
          using errcode = '45005';
      end if;
      if v_chosen < v_group.min_select then
        raise exception 'Escolha ao menos % em % (%)',
          v_group.min_select, lower(v_group.name), v_product.name
          using errcode = '45005';
      end if;
      if v_chosen > v_group.max_select then
        raise exception 'Escolha no máximo % em % (%)',
          v_group.max_select, lower(v_group.name), v_product.name
          using errcode = '45005';
      end if;
    end loop;

    select coalesce(sum(mo.price_delta_cents), 0) into v_mod_sum
    from public.modifier_options mo
    where mo.id = any(v_option_ids);

    -- --- quem vai comer -----------------------------------------------------
    -- É isto que permite dividir a conta por pessoa (spec §7). Sem indicação,
    -- é quem está pedindo.
    v_eater := nullif(v_item ->> 'guest_id', '')::uuid;
    if v_eater is null then
      v_eater := p_guest_id;
    elsif not exists (
      select 1 from public.session_guests g
      where g.id = v_eater and g.session_id = p_session_id
    ) then
      raise exception 'Pessoa indicada não está nesta mesa' using errcode = '45002';
    end if;

    v_notes := nullif(btrim(coalesce(v_item ->> 'notes', '')), '');
    if v_notes is not null then
      v_notes := left(v_notes, 280);
    end if;

    -- --- o item -------------------------------------------------------------
    insert into public.order_items (
      restaurant_id, order_id, product_id, guest_id, qty,
      unit_price_cents, total_price_cents, notes,
      promotion_id, original_price_cents, station, course
    ) values (
      v_restaurant_id, v_order_id, v_product.id, v_eater, v_qty,
      v_price.effective_price_cents,
      (v_price.effective_price_cents + v_mod_sum) * v_qty,
      v_notes,
      v_price.promotion_id,
      case when v_price.promotion_id is not null
           then v_price.list_price_cents end,
      coalesce(v_product.station_override, v_product.cat_station),
      -- Curso 2 (principal) por padrão. A marcha — segurar os principais até o
      -- garçom liberar — é decisão dele na tela do salão, não do cliente.
      2
    )
    returning id into v_item_id;

    -- SNAPSHOT dos modificadores (spec §3): grava NOME e VALOR de agora.
    -- Se o dono renomear "Bem passado" ou mudar o preço do bacon amanhã, a
    -- comanda de hoje continua dizendo o que foi pedido e quanto custou.
    insert into public.order_item_modifiers
      (restaurant_id, order_item_id, group_name, option_name, price_delta_cents)
    select v_restaurant_id, v_item_id, mg.name, mo.name, mo.price_delta_cents
    from public.modifier_options mo
    join public.modifier_groups mg on mg.id = mo.group_id
    where mo.id = any(v_option_ids);

  end loop;

  return v_order_id;
end;
$$;

comment on function public.create_guest_order(uuid, uuid, text, jsonb) is
  'Cria o pedido do cliente. Recalcula TODO valor a partir do banco — nenhum '
  'centavo vem do request (spec §10.1).';

-- =============================================================================
-- Só o servidor chama. O cliente nunca fala com esta função diretamente:
-- passa pelo Route Handler, que valida o cookie assinado da sessão antes.
-- =============================================================================
revoke all on function public.create_guest_order(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_guest_order(uuid, uuid, text, jsonb)
  to service_role;
