-- =============================================================================
-- 0035 — Restaurante de demonstração: o sistema em operação, não em branco
-- =============================================================================
-- POR QUE ISTO EXISTE
--
-- Um sistema recém-criado mostra telas vazias. Quem está avaliando o produto vê
-- um mapa de mesas livres, uma fila sem pedidos e uma cozinha sem nada na
-- chapa — e não tem como julgar nada disso.
--
-- A demo fabrica uma noite de serviço no meio: mesa ocupada há quarenta
-- minutos, pedido esperando aprovação do garçom, prato pronto esfriando na
-- passagem, item atrasado na cozinha, comanda pedindo a conta no caixa. É o
-- estado que levaria uma hora de movimento para acontecer.
--
-- PREÇO AQUI PODE
--
-- O briefing normal gera produto sem preço, porque o sistema não sabe quanto
-- AQUELA casa cobra. Aqui é diferente: o restaurante é fictício, os pratos são
-- fictícios, e sem preço não haveria comanda, nem total, nem caixa para
-- mostrar. O que não se inventa é o preço do negócio de alguém.
--
-- SEM CONTAS DE FUNCIONÁRIO
--
-- Quem gera a demo é o administrador, e administrador enxerga todas as telas
-- (`telasVisiveis` em lib/auth/staff.ts). Criar garçom, cozinha e caixa com
-- senha seria criar três credenciais que expiram em três horas e que ninguém
-- pediu — e credencial descartável tem o hábito de não ser descartada.
-- =============================================================================

/**
 * As mesas de um restaurante na ordem em que um humano as lê.
 *
 * `order by label` é ordem alfabética: com 10 mesas ela dá "Mesa 1", "Mesa 10",
 * "Mesa 2", "Mesa 3" — e a demonstração ocupava a mesa 10 no lugar da 4. O mapa
 * do salão anunciava "4 de 10 ocupadas" com a Mesa 4 vazia, que é uma
 * contradição na primeira tela que alguém abre.
 *
 * O regex tira o primeiro grupo de dígitos do rótulo; quem não tem número
 * nenhum ("Varanda", "Balcão") vai para o fim, com `created_at` desempatando.
 *
 * Existe como função, e não repetida nos dois lugares que precisam dela, porque
 * duas cópias de uma ordenação não-óbvia divergem — e a que ficar para trás vai
 * ser justamente a que ninguém olha.
 */
create or replace function app.mesas_em_ordem(p_restaurante uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select array_agg(id order by numero, created_at)
    from (
      select id, created_at,
             coalesce((substring(label from '[0-9]+'))::int, 2147483647) as numero
        from public.restaurant_tables
       where restaurant_id = p_restaurante and active
    ) t;
$$;

/**
 * Preenche um restaurante com uma noite de serviço em andamento.
 *
 * Roda como o dono, sob RLS, EXCETO onde a regra de negócio impede de propósito
 * — item de pedido nasce `pending` por trigger, e a demo precisa de itens em
 * produção. Esses saltos são feitos com `security definer` e estão marcados um
 * a um abaixo.
 *
 * SQLSTATEs:
 *   45091 sem permissão
 *   45092 o restaurante precisa de cardápio antes
 */
create or replace function public.gerar_demonstracao()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_uid uuid := auth.uid();
  v_mesas uuid[];
  v_produtos uuid[];
  v_sessao uuid;
  v_guest uuid;
  v_pedido uuid;
  v_item uuid;
  v_preco int;
  v_estacao public.station;
  v_i int;
begin
  if not app.has_any_role('owner') then
    raise exception 'Só quem administra gera a demonstração' using errcode = '45091';
  end if;

  -- A limpeza roda AQUI, e é o único gatilho que existe: sem cron, quem paga a
  -- conta das demos velhas é o próximo visitante. Funciona porque o custo é
  -- proporcional ao movimento — banco parado não acumula, banco movimentado se
  -- limpa sozinho. E se ninguém nunca mais gerar uma demo, também não há mais
  -- nada crescendo.
  perform app.limpar_demos_vencidas();

  -- Preço de verdade nos produtos: sem isso não há comanda, total nem caixa.
  -- Valores plausíveis de hamburgueria, distribuídos por categoria.
  -- Hash do nome, e não `row_number()`: função de janela não é permitida em
  -- UPDATE, e o hash tem a vantagem de dar sempre o mesmo preço ao mesmo prato
  -- — regerar a demo não faz a Margherita mudar de valor.
  update public.products p
     set price_cents = case
           when c.station = 'bar'
             then 800 + (abs(hashtext(p.name)) % 4) * 400
           else 2800 + (abs(hashtext(p.name)) % 6) * 500
         end,
         is_available = true
    from public.categories c
   where c.id = p.category_id
     and p.restaurant_id = v_restaurante
     and p.price_cents = 0;

  v_mesas := app.mesas_em_ordem(v_restaurante);

  -- Ordenado pela CATEGORIA, não pelo nome: os primeiros da lista precisam ser
  -- pratos principais, porque é neles que a demo põe "sem cebola" e "bem
  -- passado". Ordenar por nome fez a primeira versão gerar
  -- "Brownie com Sorvete — SEM CEBOLA", que é o tipo de detalhe que derruba a
  -- credibilidade da demonstração inteira.
  select array_agg(p.id order by c.sort_order, p.name) into v_produtos
    from public.products p
    join public.categories c on c.id = p.category_id
   where p.restaurant_id = v_restaurante
     and p.is_available and p.archived_at is null
     and coalesce(p.station_override, c.station) = 'cozinha';

  if v_produtos is null or array_length(v_produtos, 1) < 4 then
    raise exception 'Gere o cardápio antes da demonstração' using errcode = '45092';
  end if;

  if v_mesas is null or array_length(v_mesas, 1) < 4 then
    perform public.create_tables(6, 'Salão');
    v_mesas := app.mesas_em_ordem(v_restaurante);
  end if;

  -- ==========================================================================
  -- MESA 1 — pedido novo, esperando o garçom aprovar (§5, alerta vermelho)
  -- ==========================================================================
  insert into public.table_sessions (restaurant_id, table_id, guest_count, opened_at)
  values (v_restaurante, v_mesas[1], 2, now() - interval '12 minutes')
  returning id into v_sessao;

  insert into public.session_guests (restaurant_id, session_id, display_name)
  values (v_restaurante, v_sessao, 'Tereza') returning id into v_guest;

  insert into public.orders (restaurant_id, session_id, guest_id, source, idempotency_key)
  values (v_restaurante, v_sessao, v_guest, 'guest', 'demo-' || gen_random_uuid())
  returning id into v_pedido;

  for v_i in 1..2 loop
    select price_cents, coalesce(p.station_override, c.station)
      into v_preco, v_estacao
      from public.products p join public.categories c on c.id = p.category_id
     where p.id = v_produtos[v_i];

    insert into public.order_items
      (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
       total_price_cents, station)
    values (v_restaurante, v_pedido, v_produtos[v_i], v_guest, 1, v_preco, v_preco, v_estacao);
  end loop;

  -- ==========================================================================
  -- MESA 2 — em produção, com um item PRONTO esperando na passagem
  -- ==========================================================================
  insert into public.table_sessions (restaurant_id, table_id, guest_count, opened_at)
  values (v_restaurante, v_mesas[2], 4, now() - interval '38 minutes')
  returning id into v_sessao;

  insert into public.session_guests (restaurant_id, session_id, display_name)
  values (v_restaurante, v_sessao, 'Marcos') returning id into v_guest;

  insert into public.orders (restaurant_id, session_id, guest_id, source, idempotency_key)
  values (v_restaurante, v_sessao, v_guest, 'guest', 'demo-' || gen_random_uuid())
  returning id into v_pedido;

  -- item na PASSAGEM: pronto há 6 minutos, com uma troca — é o card que a tela
  -- do salão precisa mostrar em destaque
  select price_cents, coalesce(p.station_override, c.station) into v_preco, v_estacao
    from public.products p join public.categories c on c.id = p.category_id
   where p.id = v_produtos[3];

  insert into public.order_items
    (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
     total_price_cents, station)
  values (v_restaurante, v_pedido, v_produtos[3], v_guest, 1, v_preco, v_preco, v_estacao)
  returning id into v_item;

  insert into public.order_item_modifiers
    (restaurant_id, order_item_id, group_name, option_name, price_delta_cents)
  values (v_restaurante, v_item, 'Ajustes', 'SEM CEBOLA', 0);

  -- Item nasce `pending` por trigger (§16: nada vai para a cozinha sem o
  -- garçom). A demo precisa dos estados seguintes, e passa pelos mesmos degraus
  -- que o garçom e a cozinha dariam — nunca escrevendo o estado final direto.
  update public.order_items set status = 'queued',
         queued_at = now() - interval '22 minutes' where id = v_item;
  update public.order_items set status = 'preparing',
         started_at = now() - interval '18 minutes' where id = v_item;
  update public.order_items set status = 'ready',
         ready_at = now() - interval '6 minutes' where id = v_item;

  -- item ATRASADO, ainda na chapa: é o alerta laranja do KDS
  select price_cents, coalesce(p.station_override, c.station) into v_preco, v_estacao
    from public.products p join public.categories c on c.id = p.category_id
   where p.id = v_produtos[4];

  insert into public.order_items
    (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
     total_price_cents, station, notes)
  values (v_restaurante, v_pedido, v_produtos[4], v_guest, 2, v_preco, v_preco * 2,
          v_estacao, 'bem passado')
  returning id into v_item;

  update public.order_items set status = 'queued',
         queued_at = now() - interval '31 minutes' where id = v_item;
  update public.order_items set status = 'preparing',
         started_at = now() - interval '25 minutes' where id = v_item;

  -- O PEDIDO também precisa sair de `pending_approval`. Sem isto a mesa aparece
  -- com "Pedido novo" no mapa do salão enquanto os itens dela já estão na
  -- chapa — duas telas do mesmo sistema contando histórias diferentes.
  update public.orders
     set status = 'approved', approved_at = now() - interval '23 minutes',
         approved_by = v_uid
   where id = v_pedido;

  -- ==========================================================================
  -- MESA 3 — comeu, pediu a conta: é a que sobe no caixa
  -- ==========================================================================
  insert into public.table_sessions (restaurant_id, table_id, guest_count, opened_at)
  values (v_restaurante, v_mesas[3], 3, now() - interval '1 hour 20 minutes')
  returning id into v_sessao;

  insert into public.session_guests (restaurant_id, session_id, display_name)
  values (v_restaurante, v_sessao, 'Cláudia') returning id into v_guest;

  insert into public.orders (restaurant_id, session_id, guest_id, source, idempotency_key)
  values (v_restaurante, v_sessao, v_guest, 'guest', 'demo-' || gen_random_uuid())
  returning id into v_pedido;

  for v_i in 1..3 loop
    select price_cents, coalesce(p.station_override, c.station)
      into v_preco, v_estacao
      from public.products p join public.categories c on c.id = p.category_id
     where p.id = v_produtos[v_i];

    insert into public.order_items
      (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
       total_price_cents, station)
    values (v_restaurante, v_pedido, v_produtos[v_i], v_guest, 1, v_preco, v_preco, v_estacao)
    returning id into v_item;

    update public.order_items set status='queued',    queued_at = now() - interval '70 minutes' where id = v_item;
    update public.order_items set status='preparing', started_at = now() - interval '65 minutes' where id = v_item;
    update public.order_items set status='ready',     ready_at = now() - interval '58 minutes' where id = v_item;
    update public.order_items set status='delivered', delivered_at = now() - interval '55 minutes' where id = v_item;
  end loop;

  update public.orders
     set status = 'approved', approved_at = now() - interval '72 minutes',
         approved_by = v_uid
   where id = v_pedido;

  insert into public.waiter_calls (restaurant_id, session_id, table_id, type, created_at)
  values (v_restaurante, v_sessao, v_mesas[3], 'request_bill', now() - interval '4 minutes');

  -- ==========================================================================
  -- MESA 4 — chamou o garçom e ninguém foi
  -- ==========================================================================
  insert into public.table_sessions (restaurant_id, table_id, guest_count, opened_at)
  values (v_restaurante, v_mesas[4], 2, now() - interval '25 minutes')
  returning id into v_sessao;

  insert into public.waiter_calls (restaurant_id, session_id, table_id, type, created_at)
  values (v_restaurante, v_sessao, v_mesas[4], 'call_waiter', now() - interval '7 minutes');

  update public.restaurants set expires_at = now() + interval '3 hours'
   where id = v_restaurante;

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after
  ) values (
    v_restaurante, 'staff', v_uid, 'restaurant.demo_generated', 'restaurants',
    v_restaurante, jsonb_build_object('expira_em', now() + interval '3 hours')
  );

  return jsonb_build_object(
    'mesas_ocupadas', 4,
    'expira_em', now() + interval '3 hours'
  );
end;
$$;

revoke all on function public.gerar_demonstracao() from public, anon;
grant execute on function public.gerar_demonstracao() to authenticated;

comment on function public.gerar_demonstracao() is
  'Fabrica uma noite de serviço em andamento para o sistema poder ser avaliado '
  'cheio. Marca o restaurante para expirar em 3 horas.';
