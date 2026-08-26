-- =============================================================================
-- 0038 — As regras do cashback
-- =============================================================================
-- Arquivo separado da 0037 porque `alter type ... add value` não permite USAR o
-- valor novo na mesma transação, e cada migration roda dentro de uma. A 0037
-- acrescenta 'cashback' ao enum; aqui ele é usado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Desconto e isenção continuam exigindo um responsável; o resgate, não.
--
-- A 0037 tirou o `not null` de `created_by`. Este CHECK devolve a garantia onde
-- ela importa: todo desconto CONCEDIDO tem um nome atrás, que é como a
-- auditoria responde "quem autorizou isto?". Só o resgate de cashback fica de
-- fora, porque quem o aplica é o cliente, do próprio celular, e não há
-- funcionário a quem atribuí-lo.
--
-- Mora aqui, e não na 0037, porque cita `'cashback'` — e um valor de enum não
-- pode ser usado na transação em que nasce.
-- -----------------------------------------------------------------------------
alter table public.session_adjustments
  add constraint ajuste_da_equipe_tem_responsavel
  check (type = 'cashback' or created_by is not null);

-- -----------------------------------------------------------------------------
-- A conta da mesa, agora com a linha de cashback separada do desconto.
--
-- `discount_cents` continua sendo o desconto CONCEDIDO pela casa. O resgate sai
-- em `cashback_cents`, e os dois são subtraídos do total. Somá-los numa coluna
-- só faria o relatório do mês dizer que a casa deu de desconto um dinheiro que
-- o cliente já tinha ganhado.
-- -----------------------------------------------------------------------------
create or replace view public.session_totals
with (security_invoker = true) as
with item_totals as (
  select oi.session_id,
    sum(oi.total_price_cents) filter (
      where oi.status = any (array['held','queued','preparing','ready','delivered']::public.order_item_status[])
    ) as billable_cents,
    sum(oi.total_price_cents) filter (where oi.status = 'pending') as pending_cents,
    sum(coalesce(oi.original_price_cents, oi.unit_price_cents) * oi.qty - oi.total_price_cents) filter (
      where oi.status = any (array['held','queued','preparing','ready','delivered']::public.order_item_status[])
        and oi.promotion_id is not null
    ) as promotion_discount_cents
  from (
    select oi_1.*, o.session_id
      from public.order_items oi_1
      join public.orders o on o.id = oi_1.order_id
  ) oi
  group by oi.session_id
), adjustments as (
  select sa.session_id,
    coalesce(sum(sa.amount_cents) filter (where sa.type = 'discount'), 0) as discount_cents,
    coalesce(sum(sa.amount_cents) filter (where sa.type = 'cashback'), 0) as cashback_cents,
    bool_or(sa.type = 'service_fee_waiver') as service_fee_waived
  from public.session_adjustments sa
  group by sa.session_id
), paid as (
  select p.session_id, coalesce(sum(p.amount_cents), 0) as paid_cents
  from public.payments p group by p.session_id
), calc as (
  select s.id as session_id, s.restaurant_id, s.table_id, s.status,
    coalesce(it.billable_cents, 0)::int as subtotal_cents,
    coalesce(it.pending_cents, 0)::int as pending_cents,
    coalesce(it.promotion_discount_cents, 0)::int as promotion_discount_cents,
    coalesce(adj.service_fee_waived, false) as service_fee_waived,
    r.service_fee_pct,
    (case when coalesce(adj.service_fee_waived, false) then 0
          else round(coalesce(it.billable_cents, 0)::numeric * r.service_fee_pct / 100.0)
     end)::int as service_fee_cents,
    coalesce(adj.discount_cents, 0)::int as discount_cents,
    coalesce(adj.cashback_cents, 0)::int as cashback_cents,
    coalesce(p.paid_cents, 0)::int as paid_cents
  from public.table_sessions s
  join public.restaurants r on r.id = s.restaurant_id
  left join item_totals it on it.session_id = s.id
  left join adjustments adj on adj.session_id = s.id
  left join paid p on p.session_id = s.id
)
-- A ORDEM DAS COLUNAS É A DA VIEW ANTERIOR, e `cashback_cents` entra no FIM.
--
-- `create or replace view` não renomeia nem reordena coluna: trocar a posição
-- de `total_cents` derruba a migration com "cannot change name of view column".
-- Acrescentar no fim é a única alteração que ele aceita — e é suficiente, porque
-- o VALOR de `total_cents` pode mudar à vontade.
select
  c.session_id,
  c.restaurant_id,
  c.table_id,
  c.status,
  c.subtotal_cents,
  c.pending_cents,
  c.promotion_discount_cents,
  c.service_fee_waived,
  c.service_fee_pct,
  c.service_fee_cents,
  c.discount_cents,
  greatest(c.subtotal_cents + c.service_fee_cents - c.discount_cents - c.cashback_cents, 0) as total_cents,
  c.paid_cents,
  greatest(c.subtotal_cents + c.service_fee_cents - c.discount_cents - c.cashback_cents, 0) - c.paid_cents as balance_cents,
  c.cashback_cents
from calc c;

grant select on public.session_totals to authenticated;

-- =============================================================================
-- SALDO
-- =============================================================================

/**
 * O saldo que o cliente pode gastar AGORA.
 *
 * Crédito com menos de 24 horas não entra: `available_at` já nasce no futuro,
 * e a soma simplesmente o ignora até a hora chegar.
 */
create or replace function app.saldo_disponivel(p_cliente uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(sum(
    case when l.kind = 'credito' and l.available_at <= now() then l.amount_cents
         when l.kind = 'resgate' then -l.amount_cents
         else 0 end
  ), 0), 0)::int
  from public.customer_cashback_ledger l
  where l.customer_id = p_cliente;
$$;

/**
 * O que ainda está de carência, para a tela poder dizer "libera amanhã".
 *
 * Sem isto, quem acabou de comer vê saldo zero depois de ter ganhado cashback e
 * conclui que o recurso não funciona.
 */
create or replace function app.saldo_em_carencia(p_cliente uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.amount_cents), 0)::int
  from public.customer_cashback_ledger l
  where l.customer_id = p_cliente
    and l.kind = 'credito' and l.available_at > now();
$$;

-- =============================================================================
-- O TETO DO RESGATE
-- =============================================================================

/**
 * Quanto do saldo cabe NESTA conta.
 *
 * A regra, inteira: o abatimento nunca passa de 30% do total. Disso decorre que
 * o saldo só é gasto por completo quando a conta é 3,333…× maior que ele
 * (100/30). Não são duas regras; é uma, vista de dois lados.
 *
 * O teto incide sobre subtotal + taxa − desconto, ou seja, sobre o que a pessoa
 * pagaria sem o cashback. Calcular sobre o valor JÁ abatido seria recursivo e
 * daria um teto menor a cada iteração.
 *
 * Arredonda para BAIXO: num empate de centavo, quem fica com ele é o cliente
 * que ainda não gastou, não a casa que ainda não pagou.
 */
create or replace function app.teto_de_resgate(p_sessao uuid, p_cliente uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_antes int;
  v_saldo int;
begin
  select st.subtotal_cents + st.service_fee_cents - st.discount_cents
    into v_antes
    from public.session_totals st
   where st.session_id = p_sessao;

  if v_antes is null or v_antes <= 0 then return 0; end if;

  v_saldo := app.saldo_disponivel(p_cliente);

  return least(v_saldo, floor(v_antes * 0.30)::int);
end;
$$;

-- -----------------------------------------------------------------------------
-- Os invólucros públicos.
--
-- O PostgREST só enxerga o schema `public`; as funções acima vivem em `app`, que
-- é fechado de propósito. Estes três existem só para o servidor do Next poder
-- chamá-las por RPC — e são concedidos a `service_role`, nunca a `anon`.
--
-- Nome diferente do original (`_do_cliente`) para que ninguém confunda o que é
-- interno com o que está exposto na API.
-- -----------------------------------------------------------------------------
create or replace function public.saldo_disponivel_do_cliente(p_cliente uuid)
returns int language sql stable security definer set search_path = ''
as $$ select app.saldo_disponivel(p_cliente); $$;

create or replace function public.saldo_em_carencia_do_cliente(p_cliente uuid)
returns int language sql stable security definer set search_path = ''
as $$ select app.saldo_em_carencia(p_cliente); $$;

create or replace function public.teto_de_resgate_do_cliente(p_sessao uuid, p_cliente uuid)
returns int language sql stable security definer set search_path = ''
as $$ select app.teto_de_resgate(p_sessao, p_cliente); $$;

revoke all on function public.saldo_disponivel_do_cliente(uuid) from public, anon, authenticated;
revoke all on function public.saldo_em_carencia_do_cliente(uuid) from public, anon, authenticated;
revoke all on function public.teto_de_resgate_do_cliente(uuid, uuid) from public, anon, authenticated;
grant execute on function public.saldo_disponivel_do_cliente(uuid) to service_role;
grant execute on function public.saldo_em_carencia_do_cliente(uuid) to service_role;
grant execute on function public.teto_de_resgate_do_cliente(uuid, uuid) to service_role;

-- =============================================================================
-- CADASTRO E LOGIN
-- =============================================================================

/**
 * Cria a conta do cliente.
 *
 * `security definer` porque `customers` não aceita INSERT de ninguém: o hash da
 * senha precisa nascer aqui dentro, e o CPF precisa ser normalizado antes de
 * tocar na restrição de unicidade.
 *
 * SQLSTATEs:
 *   45100 CPF inválido
 *   45101 já existe conta com este CPF nesta casa
 *   45102 senha curta demais
 */
create or replace function public.cadastrar_cliente(
  p_restaurante uuid,
  p_cpf         text,
  p_nome        text,
  p_senha       text,
  p_telefone    text default null,
  p_email       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_id  uuid;
begin
  if v_cpf !~ '^[0-9]{11}$' then
    raise exception 'CPF precisa ter 11 dígitos' using errcode = '45100';
  end if;

  -- O piso é 8, igual ao da equipe. Não exijo símbolo nem maiúscula: regra de
  -- complexidade empurra para "Senha@123", que é pior que uma frase.
  if length(coalesce(p_senha, '')) < 8 then
    raise exception 'A senha precisa de pelo menos 8 caracteres' using errcode = '45102';
  end if;

  insert into public.customers
    (restaurant_id, cpf, name, phone, email, password_hash)
  values
    (p_restaurante, v_cpf, btrim(p_nome),
     nullif(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), ''),
     nullif(btrim(lower(coalesce(p_email, ''))), ''),
     extensions.crypt(p_senha, extensions.gen_salt('bf', 10)))
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe uma conta com este CPF aqui' using errcode = '45101';
end;
$$;

/**
 * Confere CPF e senha, e devolve o id do cliente — ou `null`.
 *
 * NULL, e não exceção, para CPF inexistente e para senha errada: a diferença
 * entre as duas respostas diz a quem estiver sondando quais CPFs têm conta
 * nesta casa, que é informação sobre pessoas reais.
 *
 * O freio de força bruta NÃO mora aqui: mora em quem chama, que é o mesmo
 * `login_permitido` da equipe (§10.6). Repetir a checagem em dois lugares faria
 * dois baldes para a mesma tentativa.
 */
create or replace function public.autenticar_cliente(
  p_restaurante uuid,
  p_cpf         text,
  p_senha       text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cpf  text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_id   uuid;
  v_hash text;
begin
  select c.id, c.password_hash into v_id, v_hash
    from public.customers c
   where c.restaurant_id = p_restaurante and c.cpf = v_cpf;

  if v_id is null then return null; end if;
  if extensions.crypt(coalesce(p_senha, ''), v_hash) <> v_hash then return null; end if;

  return v_id;
end;
$$;

-- Só o servidor do Next chama isto, com a chave de serviço, e só depois de
-- validar o cookie assinado. `anon` não alcança nenhuma das duas.
revoke all on function public.cadastrar_cliente(uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.autenticar_cliente(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.cadastrar_cliente(uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.autenticar_cliente(uuid, text, text) to service_role;

-- =============================================================================
-- RESGATE
-- =============================================================================

/**
 * Aplica o saldo do cliente na conta da mesa.
 *
 * O VALOR NÃO VEM DO CLIENTE (§10.1). O celular manda "quero usar meu saldo", e
 * é esta função que decide quanto — pelo teto de 30% e pelo saldo disponível. Se
 * o navegador mandasse o valor, mandaria o que quisesse.
 *
 * Idempotente por sessão: chamar de novo REFAZ o cálculo em vez de somar. Sem
 * isso, dois toques no botão dariam dois abatimentos, e o segundo passaria do
 * teto que o primeiro respeitou.
 *
 * SQLSTATEs:
 *   45103 sessão não está aberta
 *   45104 o cliente não é desta sessão
 */
create or replace function public.resgatar_cashback(p_sessao uuid, p_cliente uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessao   record;
  v_valor    int;
  v_anterior int;
begin
  select s.id, s.restaurant_id, s.status into v_sessao
    from public.table_sessions s where s.id = p_sessao;

  if v_sessao.id is null or v_sessao.status <> 'open' then
    raise exception 'A comanda não está aberta' using errcode = '45103';
  end if;

  -- O cliente precisa estar SENTADO nesta mesa. Sem esta checagem, um cookie
  -- válido gastaria o saldo na conta de qualquer sessão cujo id fosse
  -- descoberto — o mesmo IDOR que a §10.4 fecha para o `session_id`.
  if not exists (
    select 1 from public.session_guests g
     where g.session_id = p_sessao and g.customer_id = p_cliente
  ) then
    raise exception 'Esta conta não está nesta mesa' using errcode = '45104';
  end if;

  -- Desfaz o resgate anterior desta sessão ANTES de recalcular: é o que torna a
  -- chamada idempotente. As duas linhas saem juntas, na mesma transação.
  select coalesce(sum(sa.amount_cents), 0) into v_anterior
    from public.session_adjustments sa
   where sa.session_id = p_sessao and sa.type = 'cashback';

  if v_anterior > 0 then
    delete from public.session_adjustments
     where session_id = p_sessao and type = 'cashback';
    delete from public.customer_cashback_ledger
     where session_id = p_sessao and kind = 'resgate' and customer_id = p_cliente;
  end if;

  v_valor := app.teto_de_resgate(p_sessao, p_cliente);

  if v_valor <= 0 then
    return jsonb_build_object('aplicado_cents', 0, 'motivo', 'sem saldo utilizável');
  end if;

  insert into public.session_adjustments
    (restaurant_id, session_id, type, amount_cents, reason)
  values
    (v_sessao.restaurant_id, p_sessao, 'cashback', v_valor, 'Resgate de cashback');

  insert into public.customer_cashback_ledger
    (restaurant_id, customer_id, session_id, kind, amount_cents, available_at)
  values
    (v_sessao.restaurant_id, p_cliente, p_sessao, 'resgate', v_valor, now());

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_sessao.restaurant_id, 'guest', null, 'cashback.redeemed', 'table_sessions',
     p_sessao, jsonb_build_object('valor_cents', v_valor, 'cliente', p_cliente));

  return jsonb_build_object('aplicado_cents', v_valor);
end;
$$;

/** Tira o abatimento, para quem mudou de ideia antes de pagar. */
create or replace function public.desfazer_resgate(p_sessao uuid, p_cliente uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_valor int;
begin
  select coalesce(sum(sa.amount_cents), 0) into v_valor
    from public.session_adjustments sa
   where sa.session_id = p_sessao and sa.type = 'cashback';

  delete from public.session_adjustments
   where session_id = p_sessao and type = 'cashback';
  delete from public.customer_cashback_ledger
   where session_id = p_sessao and kind = 'resgate' and customer_id = p_cliente;

  return jsonb_build_object('devolvido_cents', v_valor);
end;
$$;

revoke all on function public.resgatar_cashback(uuid, uuid) from public, anon, authenticated;
revoke all on function public.desfazer_resgate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resgatar_cashback(uuid, uuid) to service_role;
grant execute on function public.desfazer_resgate(uuid, uuid) to service_role;

-- =============================================================================
-- CRÉDITO
-- =============================================================================

/**
 * Credita o cashback quando a comanda é quitada.
 *
 * A base é o que a casa REALMENTE recebeu pelos itens: subtotal menos desconto
 * concedido e menos o cashback resgatado. Creditar sobre o subtotal cheio faria
 * a casa devolver percentual de dinheiro que não entrou.
 *
 * A taxa de serviço fica FORA. Ela é da equipe, não receita da casa — devolver
 * percentual sobre ela é a casa pagando cashback com gorjeta alheia.
 *
 * Chamada de dentro de `register_payment`, e só quando o saldo zera.
 */
create or replace function app.creditar_cashback(p_sessao uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cliente uuid;
  v_pct     numeric;
  v_base    int;
  v_valor   int;
  v_rest    uuid;
begin
  select st.restaurant_id,
         greatest(st.subtotal_cents - st.discount_cents - st.cashback_cents, 0)
    into v_rest, v_base
    from public.session_totals st where st.session_id = p_sessao;

  if v_base is null or v_base <= 0 then return 0; end if;

  -- Já creditado nesta comanda? Devolve zero em silêncio.
  --
  -- Não é otimização: é o que torna a função segura de expor. Ela precisa ser
  -- executável por `authenticated`, porque `register_payment` roda com o papel
  -- de quem está no caixa — e o que é executável é chamável direto. O índice
  -- único em (session_id) where kind='credito' fecha a corrida; este `if`
  -- evita o erro feio no caminho normal.
  if exists (
    select 1 from public.customer_cashback_ledger
     where session_id = p_sessao and kind = 'credito'
  ) then
    return 0;
  end if;

  select r.cashback_pct into v_pct from public.restaurants r where r.id = v_rest;
  if coalesce(v_pct, 0) <= 0 then return 0; end if;

  -- Uma comanda pode ter vários convivas; o cashback vai para o PRIMEIRO com
  -- conta. Dividir entre vários exigiria saber quem consumiu o quê, que o
  -- sistema não pergunta — e ratear por cabeça premiaria quem só tomou água.
  select g.customer_id into v_cliente
    from public.session_guests g
   where g.session_id = p_sessao and g.customer_id is not null
   order by g.joined_at
   limit 1;

  if v_cliente is null then return 0; end if;

  -- Piso, não arredondamento: a casa nunca credita a mais do que prometeu.
  v_valor := floor(v_base * v_pct / 100.0)::int;
  if v_valor <= 0 then return 0; end if;

  insert into public.customer_cashback_ledger
    (restaurant_id, customer_id, session_id, kind, amount_cents,
     available_at, base_cents, pct)
  values
    (v_rest, v_cliente, p_sessao, 'credito', v_valor,
     now() + interval '24 hours', v_base, v_pct);

  return v_valor;
end;
$$;

-- `authenticated` PRECISA executar: `register_payment` não é `security
-- definer` e roda com o papel de quem está no caixa. `anon` continua fora — o
-- celular do cliente não credita nada a ninguém.
revoke all on function app.creditar_cashback(uuid) from public, anon;
grant execute on function app.creditar_cashback(uuid) to authenticated;
