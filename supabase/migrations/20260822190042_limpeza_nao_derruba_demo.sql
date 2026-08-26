-- =============================================================================
-- 0042 — A faxina nunca derruba a demonstração
-- =============================================================================
-- O DEFEITO
--
-- `gerar_demonstracao` começa chamando `app.limpar_demos_vencidas()`. Se a
-- limpeza levantar exceção — uma FK que eu não previ, uma tabela nova que
-- alguém acrescentar sem incluir na ordem de exclusão, um lock — a exceção sobe
-- e ABORTA a geração inteira.
--
-- O efeito para quem está do outro lado é exatamente o que foi relatado:
-- marcar "começar em movimento" e receber um cardápio sem preço e sem
-- movimento nenhum. O briefing rodou; a demo morreu antes de escrever a
-- primeira linha.
--
-- E é um defeito que só aparece em PRODUÇÃO: no banco local nunca há demo
-- vencida acumulada, então a limpeza não faz nada e não tem como falhar.
--
-- A IRONIA
--
-- O comentário que eu mesmo escrevi na 0034 diz que o problema de a limpeza
-- quebrar era justamente derrubar a geração do próximo visitante. Consertei o
-- sintoma (o DELETE que era barrado) e deixei a estrutura que o propaga.
--
-- FAXINA É TAREFA SECUNDÁRIA
--
-- Ela existe para o banco não encher. Falhar em arrumar a casa nunca deve
-- impedir alguém de entrar nela. O erro vai para o log do Postgres, onde quem
-- opera consegue vê-lo, e a demo segue.
-- =============================================================================

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

  -- A LIMPEZA NÃO PODE DERRUBAR A GERAÇÃO.
  --
  -- Ela é oportunista e secundária: existe para o banco free não encher, e roda
  -- de carona em quem chega. Se falhar, o certo é anotar e seguir — quem está
  -- criando a demonstração não tem nada a ver com o lixo de ontem.
  begin
    perform app.limpar_demos_vencidas();
  exception when others then
    raise warning 'limpeza de demos vencidas falhou (%): %', sqlstate, sqlerrm;
  end;

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

  update public.order_items set status = 'queued',
         queued_at = now() - interval '22 minutes' where id = v_item;
  update public.order_items set status = 'preparing',
         started_at = now() - interval '18 minutes' where id = v_item;
  update public.order_items set status = 'ready',
         ready_at = now() - interval '6 minutes' where id = v_item;

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
