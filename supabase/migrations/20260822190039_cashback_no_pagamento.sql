-- =============================================================================
-- 0039 — O cashback entra no fechamento da conta
-- =============================================================================
-- `register_payment` passa a creditar o cashback quando a comanda é quitada.
--
-- A função inteira é reescrita aqui, e não remendada, porque é o único jeito
-- honesto de alterar uma função em migration: o arquivo diz exatamente o que
-- ficou no banco, sem depender de o leitor ir buscar a versão anterior para
-- entender o resultado.
--
-- O que mudou em relação à 0021, e só isto:
--   * `v_cashback`, uma variável nova;
--   * o bloco que chama `app.creditar_cashback` quando o saldo zera;
--   * `cashback_creditado_cents` no retorno, para a tela do caixa poder dizer
--     ao cliente quanto ele acabou de ganhar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_payment(p_session_id uuid, p_method payment_method, p_amount_cents integer, p_idempotency_key text, p_tendered_cents integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_sessao   record;
  v_saldo    int;
  v_existente uuid;
  v_cashback int := 0;
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

  -- O CASHBACK NASCE AQUI, e só quando a comanda é QUITADA.
  --
  -- Creditar a cada pagamento parcial daria cashback duas vezes na conta
  -- dividida entre dois cartões. O gatilho é o saldo chegar a zero, que
  -- acontece uma vez só por comanda.
  --
  -- Sem cliente cadastrado na mesa, ou com `cashback_pct` em zero, a função
  -- devolve 0 e não escreve nada.
  if v_saldo - p_amount_cents = 0 then
    v_cashback := app.creditar_cashback(p_session_id);
  end if;

  return jsonb_build_object(
    'payment_id', v_existente,
    'repetido', false,
    'troco_cents', coalesce(p_tendered_cents - p_amount_cents, 0),
    'saldo_restante_cents', v_saldo - p_amount_cents,
    'cashback_creditado_cents', v_cashback
  );
end;
$function$;
