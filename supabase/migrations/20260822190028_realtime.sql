-- =============================================================================
-- 0028 — Realtime para as telas da equipe (spec §9)
-- =============================================================================
-- POR QUE BROADCAST E NÃO `postgres_changes`
--
-- `postgres_changes` entrega a LINHA INTEIRA a cada assinante. Confia-se na RLS
-- do canal para filtrar, e a spec §10.2 é explícita sobre o risco: "Realtime mal
-- configurado vaza tabela inteira e é um erro silencioso" — silencioso porque
-- nada quebra, o dado só sai.
--
-- Com broadcast, EU escolho o que vai no pacote. E o que vai é o mínimo:
--
--     { "tabela": "orders", "op": "INSERT" }
--
-- Nenhum valor, nenhum nome de cliente, nenhum id de comanda. O cliente ouve
-- "mudou alguma coisa em orders" e pede a tela de novo ao servidor, que a
-- monta sob RLS como sempre. Mesmo que a autorização do canal falhasse, o que
-- vazaria seria a existência de um pedido — não o pedido.
--
-- De quebra, isso resolve o orçamento da §9 por outro lado: o pacote é
-- minúsculo e o número de eventos não cresce com o tamanho da comanda.
-- =============================================================================

/**
 * Avisa a equipe do restaurante que algo mudou.
 *
 * SECURITY DEFINER: `realtime.send` insere em `realtime.messages`, que tem RLS.
 * O trigger roda como dono e ignora a policy — que é o correto, porque quem
 * PUBLICA é o banco. Quem RECEBE é filtrado pela policy abaixo.
 */
create or replace function app.notificar_equipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid;
begin
  v_restaurant_id := coalesce(
    (to_jsonb(new) ->> 'restaurant_id')::uuid,
    (to_jsonb(old) ->> 'restaurant_id')::uuid
  );

  if v_restaurant_id is null then
    return null;
  end if;

  perform realtime.send(
    -- payload mínimo: o QUE mudou, nunca o conteúdo
    jsonb_build_object('tabela', tg_table_name, 'op', tg_op),
    'mudanca',
    'restaurante:' || v_restaurant_id::text,
    true  -- canal privado: exige autorização
  );

  return null;
exception
  when others then
    -- Realtime indisponível NÃO pode derrubar a transação. Um pedido tem que
    -- entrar mesmo que a notificação falhe — a tela recarrega sozinha em
    -- alguns segundos, mas comanda perdida não volta.
    return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tabelas que a equipe precisa ver mudar (spec §9).
--
-- FOR EACH ROW, e não FOR EACH STATEMENT, apesar de statement gerar menos
-- eventos: em trigger de statement `new` e `old` são nulos, e sem eles não há
-- de onde tirar o `restaurant_id` — o aviso não teria canal para ir. Uma rodada
-- de 6 itens dispara 6 avisos; quem junta a rajada é o cliente, que agrupa em
-- 300ms antes de recarregar (`use-realtime.ts`). Custo: 6 pacotes de ~40 bytes.
-- -----------------------------------------------------------------------------
create trigger notificar_orders
  after insert or update or delete on public.orders
  for each row execute function app.notificar_equipe();

create trigger notificar_order_items
  after insert or update or delete on public.order_items
  for each row execute function app.notificar_equipe();

create trigger notificar_waiter_calls
  after insert or update or delete on public.waiter_calls
  for each row execute function app.notificar_equipe();

create trigger notificar_table_sessions
  after insert or update or delete on public.table_sessions
  for each row execute function app.notificar_equipe();

-- Só quando a DISPONIBILIDADE muda: mexer em preço ou descrição não precisa
-- acordar a tela da cozinha (spec §9 lista products por causa de is_available).
create trigger notificar_products
  after update of is_available on public.products
  for each row execute function app.notificar_equipe();

create trigger notificar_payments
  after insert on public.payments
  for each row execute function app.notificar_equipe();

-- =============================================================================
-- Autorização do canal (spec §10.2)
-- =============================================================================
-- `realtime.messages` tem RLS e nenhuma policy: hoje ninguém recebe nada. A
-- policy abaixo é a ÚNICA porta, e ela amarra o tópico ao restaurante de quem
-- está pedindo.
--
-- Não existe policy de INSERT para `authenticated`: o cliente NUNCA publica.
-- Sem isso, um garçom poderia forjar um evento e fazer a cozinha recarregar —
-- ou pior, se algum dia o payload carregasse dado, injetá-lo.
--
-- AS DUAS CONDIÇÕES SÃO NECESSÁRIAS, e por motivos diferentes.
--
--   `realtime.topic()` é o tópico que o servidor Realtime está pedindo para
--   autorizar. É a pergunta "esta pessoa pode entrar neste canal?" — e é o que
--   o Realtime de fato avalia ao aceitar a inscrição.
--
--   `messages.topic` é o tópico da LINHA. Sem esta metade, quem passasse na
--   primeira ainda leria as linhas de todos os outros restaurantes: a policy
--   autorizaria pela sessão e nunca olharia a linha. Hoje o schema `realtime`
--   não está exposto no PostgREST e o payload é `{tabela, op}`, então o que
--   vazaria seria "o restaurante X teve movimento agora". Ainda assim é o
--   vazamento silencioso da §10.2 em miniatura, e depende de uma configuração
--   que não é minha: basta alguém acrescentar `realtime` aos schemas expostos.
-- =============================================================================
create policy "equipe recebe eventos do proprio restaurante"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'restaurante:' || app.current_restaurant_id()::text
    and messages.topic = 'restaurante:' || app.current_restaurant_id()::text
  );

comment on function app.notificar_equipe() is
  'Publica "mudou X" no canal do restaurante. Payload sem conteúdo de linha, '
  'de propósito: o cliente recarrega do servidor, que aplica RLS.';
