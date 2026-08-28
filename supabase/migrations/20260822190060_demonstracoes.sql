-- =============================================================================
-- 0060 — Cinco demonstrações, uma por tipo de casa
-- =============================================================================
-- A demonstração agora é a ÚNICA coisa que vem pronta (0059). Então ela precisa
-- vir pronta de verdade: cardápio com preço, mesas, e movimento acontecendo.
--
-- POR QUE CINCO, E NÃO UMA
--
-- São cinco negócios diferentes, e a diferença aparece na tela. Uma balada
-- vende garrafa de R$ 420 e não tem entrada; uma açaiteria vende por tamanho e
-- vive de adicional; uma pizzaria vende um item que duas pessoas dividem. Um
-- "cardápio genérico" não mostra nenhum deles funcionando — e quem está
-- avaliando o produto quer se ver ali dentro, não ver uma média.
--
-- A ESCOLHA É O PRIMEIRO PASSO
--
-- Antes de conta, antes de nome. Quem entra para conhecer escolhe o tipo e cai
-- direto no sistema cheio; quem entra para montar a casa dele nunca vê esta
-- tela.
-- =============================================================================

alter table public.restaurants
  add column if not exists demo_tipo text;

comment on column public.restaurants.demo_tipo is
  'Qual demonstração este restaurante é. NULL = restaurante de verdade.';

-- -----------------------------------------------------------------------------
-- Monta o cardápio da demonstração, COM PREÇO.
--
-- Preço aqui é ficção declarada, num restaurante que some em três horas — ao
-- contrário da 0034, em que era palpite sobre o negócio de alguém.
-- -----------------------------------------------------------------------------
create or replace function app.montar_cardapio_demo(p_restaurante uuid, p_tipo text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bloco     jsonb;
  v_item      jsonb;
  v_categoria uuid;
  v_ordem     int := 0;
  v_n         int := 0;
begin
  for v_bloco in select * from jsonb_array_elements(app.cardapio_da_demonstracao(p_tipo))
  loop
    v_ordem := v_ordem + 1;

    insert into public.categories (restaurant_id, name, sort_order, station)
    values (p_restaurante, v_bloco ->> 'categoria', v_ordem,
            (v_bloco ->> 'estacao')::public.station)
    returning id into v_categoria;

    for v_item in select * from jsonb_array_elements(v_bloco -> 'itens')
    loop
      insert into public.products
        (restaurant_id, category_id, name, price_cents, is_available, sort_order)
      values
        (p_restaurante, v_categoria, v_item ->> 0, (v_item ->> 1)::int, true, v_n);
      v_n := v_n + 1;
    end loop;
  end loop;

  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- A demonstração inteira, do tipo escolhido.
--
-- Substitui `gerar_demonstracao()` sem argumento, que dependia de o cardápio já
-- existir — o que deixou de acontecer quando o restaurante de verdade passou a
-- nascer vazio (0059). Sem esta troca, a demonstração nasceria sem nada.
-- -----------------------------------------------------------------------------
create or replace function public.gerar_demonstracao(p_tipo text default 'hamburgueria')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_uid         uuid := auth.uid();
  v_valido      boolean;
  v_mesas       uuid[];
  v_cozinha     uuid[];
  v_bar         uuid[];
  v_sessao      uuid;
  v_guest       uuid;
  v_pedido      uuid;
  v_item        uuid;
  v_preco       int;
  v_prod        uuid;
  v_estacao     public.station;
  v_produtos    int;
  v_i           int;
begin
  if not app.has_any_role('owner') then
    raise exception 'Só quem administra gera a demonstração' using errcode = '45091';
  end if;

  select exists (
    select 1 from jsonb_array_elements(app.tipos_de_demonstracao()) t
     where t ->> 'valor' = p_tipo
  ) into v_valido;

  if not v_valido then
    raise exception 'Tipo de demonstração desconhecido: %', p_tipo using errcode = '45092';
  end if;

  -- A limpeza não pode derrubar a geração (0042).
  begin
    perform app.limpar_demos_vencidas();
  exception when others then
    raise warning 'limpeza de demos vencidas falhou (%): %', sqlstate, sqlerrm;
  end;

  update public.restaurants set demo_tipo = p_tipo where id = v_restaurante;

  -- Mesas primeiro: sem elas não há onde sentar ninguém.
  if not exists (select 1 from public.restaurant_tables where restaurant_id = v_restaurante) then
    perform public.create_tables(8, 'Salão');
  end if;

  v_produtos := app.montar_cardapio_demo(v_restaurante, p_tipo);

  v_mesas := app.mesas_em_ordem(v_restaurante);

  select array_agg(p.id order by c.sort_order, p.name) into v_cozinha
    from public.products p join public.categories c on c.id = p.category_id
   where p.restaurant_id = v_restaurante and p.is_available and p.archived_at is null
     and coalesce(p.station_override, c.station) = 'cozinha';

  select array_agg(p.id order by c.sort_order, p.name) into v_bar
    from public.products p join public.categories c on c.id = p.category_id
   where p.restaurant_id = v_restaurante and p.is_available and p.archived_at is null
     and coalesce(p.station_override, c.station) = 'bar';

  -- Uma balada não tem cozinha: tudo é bar. Sem este `coalesce`, o laço abaixo
  -- não teria de onde tirar item e a demonstração nasceria vazia — exatamente
  -- o tipo de coisa que só aparece no quinto tipo, depois de os quatro
  -- primeiros funcionarem.
  v_cozinha := coalesce(v_cozinha, v_bar);
  v_bar     := coalesce(v_bar, v_cozinha);

  if v_cozinha is null or array_length(v_mesas, 1) is null then
    return jsonb_build_object('produtos', v_produtos, 'mesas', 0, 'aviso', 'sem cardápio');
  end if;

  -- ── A operação em andamento ────────────────────────────────────────────
  -- QUATRO mesas em estados diferentes: uma esperando aprovação, uma na chapa,
  -- uma entregue, uma pronta para fechar. É o que mostra o sistema VIVO em vez
  -- de mostrar um cadastro preenchido — e é o que faz as telas do garçom, da
  -- cozinha e do caixa terem o que exibir ao mesmo tempo.
  for v_i in 1..least(4, array_length(v_mesas, 1)) loop
    insert into public.table_sessions (restaurant_id, table_id, guest_count)
    values (v_restaurante, v_mesas[v_i], 1 + v_i)
    returning id into v_sessao;

    insert into public.session_guests (restaurant_id, session_id, display_name)
    values (v_restaurante, v_sessao,
            (array['Ana','Bruno','Carla','Diego','Elisa'])[1 + (v_i % 5)])
    returning id into v_guest;

    insert into public.orders
      (restaurant_id, session_id, guest_id, source, idempotency_key, status,
       approved_by, approved_at)
    values
      (v_restaurante, v_sessao, v_guest, 'guest', gen_random_uuid()::text,
       -- O `case` devolve `text`, e a coluna é enum. Sem o cast explícito o
       -- Postgres recusa — e recusa só em tempo de execução, porque a função é
       -- plpgsql.
       -- `pending_approval`, e não `pending`: o pedido e o ITEM têm enums
       -- diferentes, e o do item é que tem 'pending'. O cast só reclama em
       -- tempo de execução, porque a função é plpgsql.
       (case when v_i = 1 then 'pending_approval' else 'approved' end)::public.order_status,
       case when v_i = 1 then null else v_uid end,
       case when v_i = 1 then null else now() end)
    returning id into v_pedido;

    -- O item vem da PRIMEIRA categoria de cozinha — os pratos principais.
    --
    -- E é `cozinha`, nunca bar: a versão antiga sorteava e mandou uma garrafa
    -- de água para a chapa. Numa balada, onde tudo é bar, `v_cozinha` já foi
    -- apontado para `v_bar` lá em cima, e a estação segue o produto.
    select p.id, p.price_cents, coalesce(p.station_override, c.station)
      into v_prod, v_preco, v_estacao
      from public.products p
      join public.categories c on c.id = p.category_id
     where p.restaurant_id = v_restaurante and p.is_available and p.archived_at is null
     order by c.sort_order, p.sort_order, p.name
     offset ((v_i - 1) % greatest(array_length(v_cozinha, 1), 1))
     limit 1;

    insert into public.order_items
      (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
       total_price_cents, station, notes)
    values
      (v_restaurante, v_pedido, v_prod, v_guest, 1, v_preco, v_preco, v_estacao,
       case when v_i = 2 then 'Sem cebola, por favor' end)
    returning id into v_item;

    -- Os degraus, um por um: escrever 'delivered' direto é recusado pelo
    -- gatilho de transição, e deve ser.
    if v_i = 2 then
      update public.order_items set status = 'queued' where id = v_item;
      update public.order_items set status = 'preparing' where id = v_item;
    elsif v_i = 3 then
      update public.order_items set status = 'queued' where id = v_item;
      update public.order_items set status = 'preparing' where id = v_item;
      update public.order_items set status = 'ready' where id = v_item;
    elsif v_i = 4 then
      update public.order_items set status = 'queued' where id = v_item;
      update public.order_items set status = 'preparing' where id = v_item;
      update public.order_items set status = 'ready' where id = v_item;
      update public.order_items set status = 'delivered' where id = v_item;
    end if;
  end loop;

  -- Dois chamados de garçom em aberto: é o que faz a tela do salão ter um
  -- motivo para alguém olhar para ela.
  for v_i in 1..least(2, array_length(v_mesas, 1)) loop
    insert into public.waiter_calls (restaurant_id, table_id, session_id, type)
    select v_restaurante, v_mesas[v_i], ts.id,
           (array['call_waiter', 'request_bill'])[v_i]::public.waiter_call_type
      from public.table_sessions ts
     where ts.table_id = v_mesas[v_i] and ts.status = 'open'
     limit 1;
  end loop;

  -- `expira_em` volta junto, e a ausência dela era um bug de verdade: a tela
  -- final decide qual caminho mostrar pela presença desse campo. Sem ele, quem
  -- pedia uma demonstração via a mensagem do restaurante de verdade — "o
  -- sistema não inventa o seu cardápio" — logo depois de ganhar um cardápio
  -- inteiro. Duas telas do mesmo sistema contando histórias diferentes.
  return jsonb_build_object(
    'tipo', p_tipo,
    'produtos', v_produtos,
    'mesas', array_length(v_mesas, 1),
    'expira_em', (select r.expires_at from public.restaurants r where r.id = v_restaurante)
  );
end;
$$;

grant execute on function public.gerar_demonstracao(text) to authenticated;

-- A versão sem argumento sai: ela dependia de o cardápio já existir, e desde a
-- 0059 ele não existe mais. Manter as duas faria o PostgREST escolher pelo
-- corpo da chamada, e a demonstração nasceria vazia sem ninguém entender por quê.
drop function if exists public.gerar_demonstracao();
