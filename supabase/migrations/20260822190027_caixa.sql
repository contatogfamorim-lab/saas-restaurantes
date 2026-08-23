-- =============================================================================
-- 0027 — Caixa: pagamento, desconto e remoção de taxa (spec §7 e §10.7)
-- =============================================================================
-- Todo valor em centavos, integer, sempre. Nenhum float toca dinheiro.
--
-- As três operações abaixo são as que movem dinheiro, e as três exigem a mesma
-- disciplina: permissão conferida, motivo registrado quando cabe, e rastro em
-- audit_log com quem fez. Em restaurante o prejuízo quase sempre vem de dentro
-- (spec §10.8), e desconto sem dono é o vetor mais comum.
--
-- SQLSTATEs:
--   45040 comanda não está aberta
--   45041 pagamento excede o saldo
--   45042 desconto acima do teto da função
--   45043 desconto sem motivo
--   45044 taxa já removida
--   45045 sem permissão
--   45046 valor inválido
-- =============================================================================

/**
 * Registra um pagamento.
 *
 * Aceita parcial e múltiplos métodos na mesma conta (spec §7): cada chamada
 * abate o que foi pago, e o saldo restante sai da view `session_totals`.
 *
 * `p_tendered_cents` é o que o cliente ENTREGOU, e só existe em dinheiro. O
 * troco é a diferença — nunca é registrado como pagamento, porque não entrou no
 * caixa (spec §10.7).
 */
create or replace function public.register_payment(
  p_session_id       uuid,
  p_method           public.payment_method,
  p_amount_cents     int,
  p_idempotency_key  text,
  p_tendered_cents   int default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sessao   record;
  v_saldo    int;
  v_existente uuid;
begin
  if not app.has_any_role('cashier', 'manager', 'owner') then
    raise exception 'Sem permissão para registrar pagamento' using errcode = '45045';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Valor do pagamento precisa ser positivo' using errcode = '45046';
  end if;

  select s.* into v_sessao
  from public.table_sessions s
  where s.id = p_session_id and s.status in ('open', 'closing')
  for update;

  if not found then
    raise exception 'Esta comanda não está aberta' using errcode = '45040';
  end if;

  -- Idempotência (spec §13.7): o caixa tocando duas vezes no botão com a rede
  -- lenta não pode cobrar duas vezes.
  select id into v_existente from public.payments
   where restaurant_id = v_sessao.restaurant_id and idempotency_key = p_idempotency_key;
  if v_existente is not null then
    return jsonb_build_object('payment_id', v_existente, 'repetido', true);
  end if;

  select st.balance_cents into v_saldo
  from public.session_totals st where st.session_id = p_session_id;

  -- Pagamento não excede o saldo (spec §10.7). Dinheiro com troco não é
  -- exceção a isto: o que entra no caixa é o valor da conta, e o troco sai.
  if p_amount_cents > v_saldo then
    raise exception 'Pagamento de % excede o saldo de %', p_amount_cents, v_saldo
      using errcode = '45041', detail = v_saldo::text;
  end if;

  if p_tendered_cents is not null then
    if p_method <> 'dinheiro' then
      raise exception 'Troco só existe em dinheiro' using errcode = '45046';
    end if;
    if p_tendered_cents < p_amount_cents then
      raise exception 'Valor entregue é menor que o pagamento' using errcode = '45046';
    end if;
  end if;

  insert into public.payments
    (restaurant_id, session_id, method, amount_cents, tendered_cents,
     created_by, idempotency_key)
  values
    (v_sessao.restaurant_id, p_session_id, p_method, p_amount_cents,
     p_tendered_cents, (select auth.uid()), p_idempotency_key)
  returning id into v_existente;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_sessao.restaurant_id, 'staff', (select auth.uid()),
     'payment.recorded', 'payments', v_existente,
     jsonb_build_object('metodo', p_method, 'valor_cents', p_amount_cents,
                        'entregue_cents', p_tendered_cents,
                        'saldo_antes_cents', v_saldo));

  return jsonb_build_object(
    'payment_id', v_existente,
    'repetido', false,
    'troco_cents', coalesce(p_tendered_cents - p_amount_cents, 0),
    'saldo_restante_cents', v_saldo - p_amount_cents
  );
end;
$$;

/**
 * Aplica desconto.
 *
 * O teto é por FUNÇÃO e em percentual (spec §10.3): caixa vai até 10%, gerente
 * e administrador não têm teto. Aceita valor ou percentual, e converte para
 * percentual antes de checar — senão um "desconto de R$ 50" numa conta de R$ 60
 * passaria pelo teto de 10% sem ninguém notar.
 *
 * Motivo é obrigatório. Desconto sem justificativa é o vetor de fraude interna
 * mais comum neste tipo de sistema.
 */
create or replace function public.apply_discount(
  p_session_id   uuid,
  p_reason       text,
  p_amount_cents int default null,
  p_percent      numeric default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sessao    record;
  v_subtotal  int;
  v_valor     int;
  v_percent   numeric;
  v_teto      numeric;
begin
  if not app.has_any_role('cashier', 'manager', 'owner') then
    raise exception 'Sem permissão para dar desconto' using errcode = '45045';
  end if;

  if coalesce(btrim(p_reason), '') = '' or length(btrim(p_reason)) < 3 then
    raise exception 'Desconto exige motivo' using errcode = '45043';
  end if;

  if (p_amount_cents is null) = (p_percent is null) then
    raise exception 'Informe valor OU percentual, não os dois'
      using errcode = '45046';
  end if;

  select s.* into v_sessao
  from public.table_sessions s
  where s.id = p_session_id and s.status in ('open', 'closing')
  for update;

  if not found then
    raise exception 'Esta comanda não está aberta' using errcode = '45040';
  end if;

  select st.subtotal_cents into v_subtotal
  from public.session_totals st where st.session_id = p_session_id;

  if v_subtotal <= 0 then
    raise exception 'Não há consumo para descontar' using errcode = '45046';
  end if;

  if p_percent is not null then
    if p_percent <= 0 or p_percent > 100 then
      raise exception 'Percentual precisa estar entre 0 e 100' using errcode = '45046';
    end if;
    v_percent := p_percent;
    v_valor := round(v_subtotal * p_percent / 100.0);
  else
    if p_amount_cents <= 0 then
      raise exception 'Valor do desconto precisa ser positivo' using errcode = '45046';
    end if;
    if p_amount_cents > v_subtotal then
      raise exception 'Desconto maior que o consumo' using errcode = '45046';
    end if;
    v_valor := p_amount_cents;
    -- converte para percentual ANTES de checar o teto
    v_percent := (p_amount_cents::numeric / v_subtotal) * 100;
  end if;

  v_teto := case
    when app.has_any_role('manager', 'owner') then 100
    else 10
  end;

  if v_percent > v_teto then
    raise exception 'Desconto de %%% passa do seu limite de %%%',
      round(v_percent, 1), v_teto
      using errcode = '45042', detail = v_teto::text;
  end if;

  insert into public.session_adjustments
    (restaurant_id, session_id, type, amount_cents, percent, reason, created_by)
  values
    (v_sessao.restaurant_id, p_session_id, 'discount', v_valor,
     case when p_percent is not null then p_percent end,
     btrim(p_reason), (select auth.uid()));

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_sessao.restaurant_id, 'staff', (select auth.uid()),
     'discount.applied', 'table_sessions', p_session_id,
     jsonb_build_object('valor_cents', v_valor,
                        'percentual', round(v_percent, 2),
                        'motivo', btrim(p_reason),
                        'subtotal_cents', v_subtotal));

  return jsonb_build_object('valor_cents', v_valor, 'percentual', round(v_percent, 2));
end;
$$;

/**
 * Remove a taxa de serviço (spec §7).
 *
 * Uma vez por comanda, com registro de quem removeu — é informação que o
 * dashboard do administrador agrupa por funcionário (spec §10.8).
 */
create or replace function public.waive_service_fee(
  p_session_id uuid,
  p_reason     text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_sessao record;
begin
  if not app.has_any_role('cashier', 'manager', 'owner') then
    raise exception 'Sem permissão para remover a taxa' using errcode = '45045';
  end if;

  if coalesce(btrim(p_reason), '') = '' or length(btrim(p_reason)) < 3 then
    raise exception 'Remover a taxa exige motivo' using errcode = '45043';
  end if;

  select s.* into v_sessao
  from public.table_sessions s
  where s.id = p_session_id and s.status in ('open', 'closing')
  for update;

  if not found then
    raise exception 'Esta comanda não está aberta' using errcode = '45040';
  end if;

  if exists (
    select 1 from public.session_adjustments
    where session_id = p_session_id and type = 'service_fee_waiver'
  ) then
    raise exception 'A taxa já foi removida desta comanda' using errcode = '45044';
  end if;

  insert into public.session_adjustments
    (restaurant_id, session_id, type, amount_cents, reason, created_by)
  values
    (v_sessao.restaurant_id, p_session_id, 'service_fee_waiver', 0,
     btrim(p_reason), (select auth.uid()));

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_sessao.restaurant_id, 'staff', (select auth.uid()),
     'service_fee.waived', 'table_sessions', p_session_id,
     jsonb_build_object('motivo', btrim(p_reason)));
end;
$$;

revoke all on function public.register_payment(uuid, public.payment_method, int, text, int)
  from public, anon;
revoke all on function public.apply_discount(uuid, text, int, numeric) from public, anon;
revoke all on function public.waive_service_fee(uuid, text) from public, anon;

grant execute on function public.register_payment(uuid, public.payment_method, int, text, int)
  to authenticated, service_role;
grant execute on function public.apply_discount(uuid, text, int, numeric)
  to authenticated, service_role;
grant execute on function public.waive_service_fee(uuid, text)
  to authenticated, service_role;

-- =============================================================================
-- Comandas abertas, prontas para a lista do caixa (spec §7)
-- =============================================================================
create view public.open_bills
with (security_invoker = on) as
select
  s.id                     as session_id,
  s.restaurant_id,
  s.status,
  s.opened_at,
  s.guest_count,
  t.label                  as mesa,
  t.area,
  w.name                   as garcom,
  st.subtotal_cents,
  st.pending_cents,
  st.service_fee_cents,
  st.discount_cents,
  st.service_fee_waived,
  st.total_cents,
  st.paid_cents,
  st.balance_cents,
  (select count(*)::int from public.session_guests g where g.session_id = s.id)
                           as pessoas,
  -- sinal de que a mesa pediu a conta: é por onde o caixa começa a fila
  exists (
    select 1 from public.waiter_calls wc
    where wc.session_id = s.id and wc.type = 'request_bill' and wc.status = 'open'
  )                        as pediu_a_conta,
  -- itens ainda em produção travam a liberação normal (spec §5)
  (select count(*)::int from public.order_items oi
     join public.orders o on o.id = oi.order_id
    where o.session_id = s.id and oi.status in ('pending', 'held', 'queued', 'preparing'))
                           as em_producao,
  extract(epoch from (now() - s.opened_at))::int as aberta_ha_segundos
from public.table_sessions s
join public.restaurant_tables t on t.id = s.table_id
join public.session_totals st   on st.session_id = s.id
left join public.profiles w     on w.id = s.waiter_id
where s.status in ('open', 'closing');

grant select on public.open_bills to authenticated, service_role;

comment on view public.open_bills is
  'Comandas abertas com o total já derivado. É a lista da tela do caixa.';
