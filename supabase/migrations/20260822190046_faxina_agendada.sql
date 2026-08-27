-- =============================================================================
-- 0046 — A faxina passa a ter hora marcada
-- =============================================================================
-- O QUE ESTAVA ERRADO
--
-- A limpeza era OPORTUNISTA: rodava só de dentro de `gerar_demonstracao`. A
-- justificativa escrita na 0034 era "sempre tem quem a dispare — todo visitante
-- novo", e ela é falsa para o caso que importa. Num endereço de portfólio o
-- movimento é irregular: passam dias sem ninguém gerar demonstração alguma, e
-- nesse intervalo NADA é limpo.
--
-- O efeito foi observado em produção: uma demonstração vencida há mais de um
-- dia, intacta, com todos os pedidos e mesas. O prazo de 3 horas que a tela
-- promete ao cliente simplesmente não estava sendo cumprido.
--
-- `pg_cron` de hora em hora resolve, e é dependência que o Supabase já oferece
-- em todos os planos. A "complexidade a mais" que a 0034 quis evitar custa uma
-- linha; o custo de não tê-la é o banco crescer para sempre.
--
-- DE HORA EM HORA, E NÃO A CADA MINUTO
--
-- A promessa é "some em 3 horas". Uma hora de folga na execução não quebra
-- nada, e varrer o banco a cada minuto seria trabalho constante para um evento
-- que acontece poucas vezes por dia.
-- =============================================================================

create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- Agenda a faxina.
--
-- Envolto em bloco de exceção porque `cron.schedule` exige privilégio que nem
-- todo ambiente concede — e uma migration que falha por causa da faxina
-- impediria o deploy de tudo o mais. Sem o agendamento, o comportamento volta a
-- ser o de antes (oportunista), que é ruim mas não é quebrado.
-- -----------------------------------------------------------------------------
do $$
begin
  perform cron.schedule(
    'faxina-das-demonstracoes',
    '7 * * * *',  -- minuto 7 de cada hora: fora do topo, onde tudo mais roda
    $cmd$ select app.limpar_demos_vencidas() $cmd$
  );
exception when others then
  raise warning 'não deu para agendar a faxina (%): %', sqlstate, sqlerrm;
end;
$$;

-- =============================================================================
-- A DEMONSTRAÇÃO JÁ NASCE COM PRAZO — E A MARCA VEM DO BRIEFING
-- =============================================================================
-- O outro defeito, e o mais grave dos dois.
--
-- `gerar_demonstracao` marcava `expires_at` no FIM. Se algo falhasse no meio, o
-- restaurante ficava com `expires_at` nulo — o mesmo que "casa de verdade,
-- permanente". Foi o que aconteceu em produção: uma demonstração pedida, cuja
-- geração falhou, virou um cadastro definitivo que a faxina não reconhece.
--
-- A CORREÇÃO ÓBVIA NÃO FUNCIONA, e vale registrar por quê.
--
-- Mover o `update` para o começo da função não resolve nada: `raise exception`
-- desfaz TUDO o que a função escreveu, inclusive esse update. A função é uma
-- transação só. Escrevi essa versão, o teste passou, e ele passava por
-- vacuidade — `esperaFalhar` desfazia justamente a linha que eu queria conferir.
--
-- A marca precisa ser gravada FORA da transação que falha. E ela já existe:
-- `aplicar_briefing` é uma chamada RPC separada, que COMMITA antes de a
-- demonstração começar. É lá que a intenção de quem marcou a caixa fica
-- registrada.
-- =============================================================================

/**
 * Marca o restaurante como demonstração, com prazo.
 *
 * Chamada pela Server Action ANTES de `gerar_demonstracao`, em transação
 * própria. Assim, geração que falhe no meio deixa para trás um restaurante que
 * a faxina reconhece e remove — e não um cadastro permanente que ninguém pediu.
 *
 * Idempotente: chamar de novo não estende o prazo, para quem regerar a demo não
 * ganhar mais três horas a cada tentativa.
 */
create or replace function public.marcar_como_demonstracao()
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_prazo timestamptz;
begin
  if not app.has_any_role('owner') then
    raise exception 'Só quem administra gera a demonstração' using errcode = '45091';
  end if;

  update public.restaurants
     set expires_at = coalesce(expires_at, now() + interval '3 hours')
   where id = v_restaurante
  returning expires_at into v_prazo;

  return v_prazo;
end;
$$;

revoke all on function public.marcar_como_demonstracao() from public, anon;
grant execute on function public.marcar_como_demonstracao() to authenticated;

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

  -- O prazo NÃO é marcado aqui: quem marca é `marcar_como_demonstracao`, numa
  -- transação própria, antes desta função ser chamada. Ver o cabeçalho — um
  -- `update` aqui dentro seria desfeito junto com o resto se algo falhasse.
  --
  -- A limpeza não pode derrubar a geração (0042). Agora ela também roda de hora
  -- em hora por `pg_cron`, então esta chamada virou reforço, não a única chance.
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
