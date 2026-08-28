-- =============================================================================
-- 0054 — Carência configurável e expiração do saldo
-- =============================================================================
-- A 0053 acrescentou as colunas e o valor 'expiracao' do enum. Aqui está o que
-- USA as duas coisas — separado por obrigação do Postgres, não por gosto: valor
-- de enum não pode ser usado na transação em que nasce (55P04).
--
-- COMO O SALDO EXPIRA SEM PUNIR QUEM GASTOU
--
-- O jeito ingênuo — "não contar crédito velho" — está errado, e erra contra o
-- cliente. Crédito antigo de R$ 100, crédito novo de R$ 50, resgate de R$ 80
-- feito quando os dois valiam: o saldo real é R$ 70. Ignorar o crédito velho
-- daria 50 − 80 = −30, que vira zero — a pessoa perderia os R$ 50 novos por
-- ter gastado os antigos.
--
-- O certo é entender que RESGATE CONSOME O MAIS VELHO PRIMEIRO. Então caduca
-- só o que sobrou de velho:
--
--   caducou = maior(0, saldo_atual − créditos_dentro_da_validade)
--
-- No exemplo: 70 − 50 = 20 caducam, e os 50 novos ficam.
--
-- E a expiração vira UMA LINHA no extrato, com valor e data. O saldo continua
-- sendo a soma dos lançamentos, sem regra escondida em consulta — e o cliente
-- vê o que perdeu, que é o mínimo antes de tirar algo de alguém.
-- =============================================================================

-- =============================================================================
-- A CARÊNCIA PASSA A VIR DA CASA
-- =============================================================================
create or replace function app.creditar_cashback(p_sessao uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cliente  uuid;
  v_pct      numeric;
  v_base     int;
  v_valor    int;
  v_rest     uuid;
  v_carencia int;
begin
  select st.restaurant_id,
         greatest(st.subtotal_cents - st.discount_cents - st.cashback_cents, 0)
    into v_rest, v_base
    from public.session_totals st where st.session_id = p_sessao;

  if v_base is null or v_base <= 0 then return 0; end if;

  if exists (
    select 1 from public.customer_cashback_ledger
     where session_id = p_sessao and kind = 'credito'
  ) then
    return 0;
  end if;

  select r.cashback_pct, r.cashback_carencia_horas
    into v_pct, v_carencia
    from public.restaurants r where r.id = v_rest;

  if coalesce(v_pct, 0) <= 0 then return 0; end if;

  select g.customer_id into v_cliente
    from public.session_guests g
   where g.session_id = p_sessao and g.customer_id is not null
   order by g.joined_at
   limit 1;

  if v_cliente is null then return 0; end if;

  v_valor := floor(v_base * v_pct / 100.0)::int;
  if v_valor <= 0 then return 0; end if;

  insert into public.customer_cashback_ledger
    (restaurant_id, customer_id, session_id, kind, amount_cents,
     available_at, base_cents, pct)
  values
    (v_rest, v_cliente, p_sessao, 'credito', v_valor,
     -- A carência agora vem da casa. `coalesce` para 24 porque restaurante
     -- criado antes desta migration não tem a coluna preenchida em memória de
     -- ninguém — o default cobre, e o coalesce cobre o default sumindo.
     now() + (coalesce(v_carencia, 24) || ' hours')::interval,
     v_base, v_pct);

  return v_valor;
end;
$$;

grant execute on function app.creditar_cashback(uuid) to authenticated, service_role;

-- =============================================================================
-- O SALDO, COM EXPIRAÇÃO
-- =============================================================================
-- A fórmula não muda: soma dos lançamentos. É a expiração que vira lançamento.
-- =============================================================================
create or replace function app.saldo_disponivel(p_cliente uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(sum(
    case when l.kind = 'credito' and l.available_at <= now() then l.amount_cents
         when l.kind = 'resgate'   then -l.amount_cents
         when l.kind = 'expiracao' then -l.amount_cents
         else 0 end
  ), 0), 0)::int
  from public.customer_cashback_ledger l
  where l.customer_id = p_cliente;
$$;

-- -----------------------------------------------------------------------------
-- Quanto caducaria AGORA, se a faxina rodasse neste instante.
--
-- Separada da faxina de propósito: é ela que o aviso de "seu saldo vai expirar"
-- consulta, e um aviso não pode ter efeito colateral.
-- -----------------------------------------------------------------------------
create or replace function app.cashback_a_caducar(p_cliente uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_validade int;
  v_saldo    int;
  v_recentes int;
begin
  select r.cashback_validade_dias into v_validade
    from public.customers c
    join public.restaurants r on r.id = c.restaurant_id
   where c.id = p_cliente;

  -- Zero é "nunca expira", e é o padrão. Sem esta saída, validade 0 faria o
  -- corte cair em `now()` e TODO o saldo caducaria de uma vez.
  if coalesce(v_validade, 0) <= 0 then return 0; end if;

  v_saldo := app.saldo_disponivel(p_cliente);
  if v_saldo <= 0 then return 0; end if;

  -- O que os créditos DENTRO da validade conseguem explicar do saldo.
  select coalesce(sum(l.amount_cents), 0)::int into v_recentes
    from public.customer_cashback_ledger l
   where l.customer_id = p_cliente
     and l.kind = 'credito'
     and l.created_at > now() - (v_validade || ' days')::interval;

  -- O resto veio de crédito velho, e é o que caduca. Resgate consome o mais
  -- velho primeiro — ver o cabeçalho da 0053 sobre por que o caminho ingênuo
  -- erra contra o cliente.
  return greatest(v_saldo - v_recentes, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- Quando o saldo de hoje vai caducar.
--
-- É a data do crédito mais VELHO que ainda sustenta saldo, mais a validade.
-- Nula quando não há o que caducar.
-- -----------------------------------------------------------------------------
create or replace function app.cashback_caduca_em(p_cliente uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_validade int;
  v_saldo    int;
  v_acum     int := 0;
  v_linha    record;
begin
  select r.cashback_validade_dias into v_validade
    from public.customers c
    join public.restaurants r on r.id = c.restaurant_id
   where c.id = p_cliente;

  if coalesce(v_validade, 0) <= 0 then return null; end if;

  v_saldo := app.saldo_disponivel(p_cliente);
  if v_saldo <= 0 then return null; end if;

  -- Anda dos créditos MAIS NOVOS para trás até cobrir o saldo. O último que
  -- entrar na conta é o mais velho que ainda sustenta saldo — e é a validade
  -- DELE que manda.
  for v_linha in
    select l.amount_cents, l.created_at
      from public.customer_cashback_ledger l
     where l.customer_id = p_cliente and l.kind = 'credito'
     order by l.created_at desc
  loop
    v_acum := v_acum + v_linha.amount_cents;
    if v_acum >= v_saldo then
      return v_linha.created_at + (v_validade || ' days')::interval;
    end if;
  end loop;

  return null;
end;
$$;

grant execute on function app.cashback_a_caducar(uuid) to authenticated, service_role;
grant execute on function app.cashback_caduca_em(uuid) to authenticated, service_role;

-- =============================================================================
-- A FAXINA DO SALDO VENCIDO
-- =============================================================================
-- Escreve UMA linha de expiração por cliente que tem o que caducar. Nunca
-- apaga crédito: o extrato precisa continuar mostrando o que entrou e o que
-- saiu, inclusive quando o que saiu foi o tempo passando.
-- =============================================================================
create or replace function public.expirar_cashback_vencido()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cli   record;
  v_valor int;
  v_n     int := 0;
begin
  for v_cli in
    select distinct c.id, c.restaurant_id
      from public.customers c
      join public.restaurants r on r.id = c.restaurant_id
      join public.customer_cashback_ledger l on l.customer_id = c.id
     where r.cashback_validade_dias > 0
       and l.kind = 'credito'
  loop
    v_valor := app.cashback_a_caducar(v_cli.id);
    continue when v_valor <= 0;

    insert into public.customer_cashback_ledger
      (restaurant_id, customer_id, session_id, kind, amount_cents,
       available_at, base_cents, pct)
    values
      (v_cli.restaurant_id, v_cli.id, null, 'expiracao', v_valor, now(), 0, 0);

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.expirar_cashback_vencido() from public, anon, authenticated;
grant execute on function public.expirar_cashback_vencido() to service_role;

-- -----------------------------------------------------------------------------
-- Uma vez por dia, de madrugada, no fuso de São Paulo.
--
-- 4h da manhã porque é depois do fechamento de qualquer casa: expirar saldo no
-- meio do serviço faria o cliente ver um número na tela e outro no caixa.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expiracao-de-cashback')
      where exists (select 1 from cron.job where jobname = 'expiracao-de-cashback');
    perform cron.schedule(
      'expiracao-de-cashback', '0 7 * * *',   -- 7h UTC = 4h em São Paulo
      $cron$ select public.expirar_cashback_vencido(); $cron$
    );
  end if;
end $$;
