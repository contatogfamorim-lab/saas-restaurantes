-- =============================================================================
-- 0029 — Console de gestão: relatórios, clientes e telefone (spec §8 e §10.9)
-- =============================================================================
-- DUAS COISAS QUE ESTA MIGRATION CONSERTA
--
-- 1. Relatório é dado sensível, e a RLS de hoje não trata assim.
--
--    `payments_staff_read` é `restaurant_id = app.current_restaurant_id()`, sem
--    checagem de papel — o que faz sentido para o caixa, que precisa ver os
--    pagamentos da comanda. Mas significa que a cozinha pode pedir
--    `/rest/v1/payments?select=amount_cents` e somar o faturamento da casa.
--    Esconder o menu não muda isso: PostgREST está aberto para quem tem token.
--
--    As views daqui fecham essa porta no lugar certo, o dado: cada uma exige
--    `owner` ou `manager` na própria definição. Sem o papel, a view devolve
--    zero linhas — para o app, para o PostgREST, para qualquer caminho.
--
-- 2. O telefone do cliente está legível em texto puro para a casa inteira.
--
--    A §10.9 manda mascarar por padrão e liberar o valor cheio só para
--    gerente/dono, com auditoria. Hoje isso vive só no `maskPhone()` do
--    TypeScript, e `maskPhone()` não protege `select phone from session_guests`.
--    Aqui o privilégio da COLUNA é revogado e o valor cheio passa a sair por
--    uma função que confere o papel e grava quem olhou.
--
-- DINHEIRO
--
-- Tudo em centavos, integer. Receita de produto sai de
-- `order_items.total_price_cents` — o preço CONGELADO no momento do pedido.
-- Nunca de `products.price_cents`: o preço de hoje somado a uma venda de ontem
-- é um relatório que mente devagar, e ninguém percebe.
--
-- O DIA, DEFINIDO UMA VEZ SÓ
--
-- O dia de qualquer número aqui é o de `table_sessions.opened_at` no fuso do
-- restaurante. Comanda aberta 23h30 e paga 01h00 conta inteira no dia em que a
-- mesa sentou.
--
-- Isso vale inclusive para pagamento e para item, que têm `created_at` próprio:
-- usar o carimbo de cada tabela partiria a noite de sábado ao meio, e o dono
-- veria a mesma comanda dividida em dois dias — bruto num, recebido no outro.
-- Um relatório assim não fecha, e quem olha conclui que o sistema está errado
-- em algum lugar que ninguém acha.
-- =============================================================================

/**
 * Quem pode ver relatório.
 *
 * Separado em função para a regra existir UMA vez: sete views repetindo o
 * mesmo `has_any_role` é sete lugares para alguém esquecer de mexer.
 */
create or replace function app.can_view_reports()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_any_role('owner', 'manager');
$$;

comment on function app.can_view_reports() is
  'Portão dos relatórios da §8. Espelha dashboard.view/audit.view de lib/permissions.ts.';

-- =============================================================================
-- VENDAS
-- =============================================================================

/**
 * Movimento por dia.
 *
 * Uma linha por dia com mesa aberta. Os valores saem de `session_totals`, que
 * já é a fonte única do total de uma comanda — recalcular aqui seria criar uma
 * segunda verdade sobre dinheiro.
 */
create or replace view public.daily_sales
with (security_invoker = on) as
select
  s.restaurant_id,
  (s.opened_at at time zone r.timezone)::date          as dia,
  count(*)::int                                        as comandas,
  coalesce(sum(s.guest_count), 0)::int                 as pessoas,
  coalesce(sum(t.subtotal_cents), 0)::bigint           as bruto_cents,
  coalesce(sum(t.promotion_discount_cents), 0)::bigint as desconto_promocao_cents,
  coalesce(sum(t.discount_cents), 0)::bigint           as desconto_manual_cents,
  coalesce(sum(t.service_fee_cents), 0)::bigint        as taxa_servico_cents,
  coalesce(sum(t.total_cents), 0)::bigint              as total_cents,
  coalesce(sum(t.paid_cents), 0)::bigint               as recebido_cents,
  -- Ticket médio por PESSOA, não por comanda: é o número que diz se a casa
  -- está vendendo mais, e não apenas recebendo mesas mais cheias.
  case
    when coalesce(sum(s.guest_count), 0) > 0
      then (coalesce(sum(t.total_cents), 0) / sum(s.guest_count))::int
    else 0
  end                                                  as ticket_medio_cents
from public.table_sessions s
join public.restaurants r on r.id = s.restaurant_id
join public.session_totals t on t.session_id = s.id
where s.status <> 'cancelled'
  and app.can_view_reports()
group by s.restaurant_id, (s.opened_at at time zone r.timezone)::date;

comment on view public.daily_sales is
  'Movimento por dia, no fuso do restaurante. Só owner/manager (spec §8).';

/**
 * Como o dinheiro entrou, por dia e por meio.
 *
 * O troco NÃO aparece: `tendered_cents` é o que a pessoa entregou na mão, e a
 * diferença voltou para ela. Somar isso inflaria o caixa (spec §10.7).
 */
create or replace view public.payment_mix
with (security_invoker = on) as
select
  p.restaurant_id,
  (s.opened_at at time zone r.timezone)::date as dia,
  p.method,
  count(*)::int                               as quantidade,
  coalesce(sum(p.amount_cents), 0)::bigint    as total_cents
from public.payments p
join public.table_sessions s on s.id = p.session_id
join public.restaurants r on r.id = p.restaurant_id
where app.can_view_reports()
group by p.restaurant_id, (s.opened_at at time zone r.timezone)::date, p.method;

comment on view public.payment_mix is
  'Entrada por meio de pagamento. Troco fora, porque troco não entrou no caixa.';

/**
 * O que vendeu, por produto e por dia.
 *
 * `total_price_cents` é o preço congelado na hora do pedido (spec P4). Juntar
 * com `products.price_cents` para recalcular daria um número plausível e
 * errado sempre que o cardápio mudasse de preço.
 *
 * Item recusado, cancelado ou esgotado fica de fora: não virou comida nem
 * dinheiro.
 */
create or replace view public.product_sales
with (security_invoker = on) as
select
  oi.restaurant_id,
  (s.opened_at at time zone r.timezone)::date    as dia,
  oi.product_id,
  p.name                                         as produto,
  c.name                                         as categoria,
  coalesce(sum(oi.qty), 0)::int                  as quantidade,
  coalesce(sum(oi.total_price_cents), 0)::bigint as receita_cents,
  coalesce(sum(
    (coalesce(oi.original_price_cents, oi.unit_price_cents) * oi.qty)
      - oi.total_price_cents
  ), 0)::bigint                                  as desconto_cents
from public.order_items oi
join public.orders o on o.id = oi.order_id
join public.table_sessions s on s.id = o.session_id
join public.restaurants r on r.id = oi.restaurant_id
join public.products p on p.id = oi.product_id
join public.categories c on c.id = p.category_id
where oi.status in ('held', 'queued', 'preparing', 'ready', 'delivered')
  and app.can_view_reports()
group by oi.restaurant_id, (s.opened_at at time zone r.timezone)::date,
         oi.product_id, p.name, c.name;

comment on view public.product_sales is
  'Venda por produto, a preço CONGELADO do pedido. Nunca products.price_cents.';

-- =============================================================================
-- OPERAÇÃO
-- =============================================================================

/**
 * Como a cozinha andou, por dia e por estação.
 *
 * A mediana e não a média: uma comanda esquecida por duas horas puxa a média
 * para um número que não descreve nenhuma noite real. O p90 fica ao lado
 * porque é ele que corresponde à reclamação do cliente — o dono quer saber
 * quanto esperou quem esperou mais, não o caso típico.
 *
 * O ATRASO É RECALCULADO AQUI, e não herdado de `order_item_timings.is_late`.
 *
 * Aquele `is_late` é bandeira de tela ao vivo: "ainda está na fila E já passou
 * de 1,5× o previsto". Para item entregue ele é sempre falso — a condição de
 * status não se sustenta depois que o prato saiu. Usá-lo num relatório dá
 * "0% fora do prazo" em qualquer período, o que não é um número baixo: é a
 * pergunta nunca tendo sido feita, com cara de resposta boa.
 *
 * Aqui a conta é sobre o tempo REGISTRADO, e sobre a PRODUÇÃO — do início do
 * preparo até ficar pronto —, não sobre o total.
 *
 * `prep_minutes` é a estimativa de PREPARO. Comparar o total contra ela mistura
 * duas coisas: um chopp de 2 minutos que esperou 4 na fila apareceria como
 * "300% do previsto" sem o bar ter demorado nada — o atraso foi de quem não
 * puxou o pedido. A fila tem coluna própria ao lado, e é lá que esse problema
 * deve aparecer, com o nome certo.
 */
create or replace view public.kitchen_performance
with (security_invoker = on) as
select
  t.restaurant_id,
  (s.opened_at at time zone r.timezone)::date as dia,
  t.station                                   as estacao,
  count(*)::int                               as itens,
  count(*) filter (
    where t.prep_minutes is not null
      and t.producao_seconds > t.prep_minutes * 90   -- 1,5 × prep_minutes, em segundos
  )::int                                      as atrasados,
  (percentile_cont(0.5) within group (order by t.total_seconds))::int  as mediana_seg,
  (percentile_cont(0.9) within group (order by t.total_seconds))::int  as p90_seg,
  (percentile_cont(0.5) within group (order by t.fila_seconds))::int   as mediana_fila_seg
from public.order_item_timings t
join public.table_sessions s on s.id = t.session_id
join public.restaurants r on r.id = t.restaurant_id
where t.queued_at is not null
  and t.total_seconds is not null
  and app.can_view_reports()
group by t.restaurant_id, (s.opened_at at time zone r.timezone)::date, t.station;

comment on view public.kitchen_performance is
  'Tempo de produção por estação. Mediana e p90, nunca média (spec §8).';

/**
 * Itens que não viraram comida, por motivo.
 *
 * Recusa alta num produto costuma ser cardápio errado — foto que promete o que
 * o prato não é, ou item que vive esgotado e ninguém tirou do ar.
 */
create or replace view public.rejected_items
with (security_invoker = on) as
select
  oi.restaurant_id,
  (s.opened_at at time zone r.timezone)::date as dia,
  oi.product_id,
  p.name                                      as produto,
  oi.status                                   as desfecho,
  oi.rejection_reason                         as motivo,
  count(*)::int                               as ocorrencias
from public.order_items oi
join public.orders o on o.id = oi.order_id
join public.table_sessions s on s.id = o.session_id
join public.restaurants r on r.id = oi.restaurant_id
join public.products p on p.id = oi.product_id
where oi.status in ('cancelled', 'out_of_stock')
  and app.can_view_reports()
group by oi.restaurant_id, (s.opened_at at time zone r.timezone)::date,
         oi.product_id, p.name, oi.status, oi.rejection_reason;

comment on view public.rejected_items is
  'Recusas e esgotados por produto e motivo (spec §8).';

-- =============================================================================
-- PROMOÇÕES
-- =============================================================================

/**
 * Quanto cada promoção rodou e quanto custou.
 *
 * `desconto_cents` é a diferença entre o preço que valeria e o que foi cobrado,
 * ambos congelados no item. É o custo REAL da promoção, não o que ela prometia
 * na configuração.
 */
create or replace view public.promotion_performance
with (security_invoker = on) as
select
  pr.restaurant_id,
  pr.id                                          as promotion_id,
  pr.name                                        as promocao,
  pr.discount_type,
  pr.status,
  pr.priority,
  pr.max_quantity,
  pr.used_quantity,
  count(oi.id)::int                              as itens,
  coalesce(sum(oi.qty), 0)::int                  as unidades,
  coalesce(sum(oi.total_price_cents), 0)::bigint as receita_cents,
  coalesce(sum(
    (coalesce(oi.original_price_cents, oi.unit_price_cents) * oi.qty)
      - oi.total_price_cents
  ), 0)::bigint                                  as desconto_cents
from public.promotions pr
left join public.order_items oi
  on oi.promotion_id = pr.id
 and oi.status in ('held', 'queued', 'preparing', 'ready', 'delivered')
where app.can_view_reports()
group by pr.restaurant_id, pr.id, pr.name, pr.discount_type, pr.status,
         pr.priority, pr.max_quantity, pr.used_quantity;

comment on view public.promotion_performance is
  'Custo real de cada promoção, pelo preço congelado nos itens (spec §8).';

-- =============================================================================
-- EQUIPE — o que a §10.8 chama de prejuízo que vem de dentro
-- =============================================================================

/**
 * O que cada pessoa fez com dinheiro.
 *
 * Não é vigilância de produtividade — é a lista curta das ações que movem
 * valor sem uma venda por trás: desconto concedido, taxa removida, mesa
 * liberada com saldo em aberto. A §10.8 é explícita sobre onde o prejuízo
 * costuma nascer.
 *
 * `a.type::text` porque o outro braço do UNION traz um literal: enum e texto
 * não se unem sozinhos.
 */
create or replace view public.staff_money_actions
with (security_invoker = on) as
select
  a.restaurant_id,
  (s.opened_at at time zone r.timezone)::date as dia,
  a.created_by                                as profile_id,
  pf.name                                     as funcionario,
  a.type::text                                as acao,
  count(*)::int                               as ocorrencias,
  coalesce(sum(a.amount_cents), 0)::bigint    as total_cents
from public.session_adjustments a
join public.table_sessions s on s.id = a.session_id
join public.restaurants r on r.id = a.restaurant_id
left join public.profiles pf on pf.id = a.created_by
where app.can_view_reports()
group by a.restaurant_id, (s.opened_at at time zone r.timezone)::date,
         a.created_by, pf.name, a.type

union all

select
  s.restaurant_id,
  (s.opened_at at time zone r.timezone)::date,
  s.released_by,
  pf.name,
  'force_release',
  count(*)::int,
  0::bigint
from public.table_sessions s
join public.restaurants r on r.id = s.restaurant_id
left join public.profiles pf on pf.id = s.released_by
where s.force_released
  and s.released_at is not null
  and app.can_view_reports()
group by s.restaurant_id, (s.opened_at at time zone r.timezone)::date,
         s.released_by, pf.name;

comment on view public.staff_money_actions is
  'Desconto, taxa removida e liberação forçada, por pessoa (spec §10.8).';

-- =============================================================================
-- CLIENTES — §10.9
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A máscara é uma COLUNA do banco, não um `case` na view.
--
-- Tentei o `case` primeiro e não funciona: view com `security_invoker = on` lê
-- as tabelas com os privilégios de quem consulta, então uma view que toca
-- `phone` exige `select (phone)` do funcionário — exatamente o privilégio que
-- as linhas seguintes revogam. A view quebraria para todo mundo.
--
-- Coluna gerada resolve pelos dois lados: o valor mascarado é calculado pelo
-- banco a partir do telefone, e o privilégio dela é independente do da coluna
-- crua. Dá para conceder a máscara e negar o número.
-- -----------------------------------------------------------------------------
alter table public.session_guests
  add column if not exists phone_mask text
  generated always as (
    case when phone is null then null else '•••••-' || right(phone, 4) end
  ) stored;

comment on column public.session_guests.phone_mask is
  'Telefone mascarado (spec §10.9). É esta coluna que a equipe enxerga; '
  '`phone` está revogada para authenticated.';

-- -----------------------------------------------------------------------------
-- O privilégio da coluna.
--
-- Sem isto, tudo acima é decoração: qualquer funcionário faria
-- `select phone from session_guests` e teria a lista inteira em texto puro. A
-- máscara só vale se o caminho cru estiver fechado.
--
-- `open_guest_session` e `reveal_guest_phone` continuam funcionando porque são
-- SECURITY DEFINER e rodam como dono da função, fora deste GRANT.
-- -----------------------------------------------------------------------------
revoke select on public.session_guests from authenticated, anon;

grant select (
  id, restaurant_id, session_id, display_name, phone_mask, device_hash,
  joined_at, lgpd_consent_at, created_at, updated_at
) on public.session_guests to authenticated;

/**
 * Diretório de clientes, com o telefone já mascarado.
 *
 * Não é desconfiança do dono: é que a tela de clientes fica aberta no balcão, e
 * uma lista de telefones inteiros à vista não é a mesma coisa que consultar um
 * telefone quando há motivo. Quem precisa do número usa `reveal_guest_phone`,
 * que pergunta o papel e grava quem olhou.
 */
create or replace view public.customer_directory
with (security_invoker = on) as
select
  g.restaurant_id,
  g.id                       as guest_id,
  g.session_id,
  g.display_name             as nome,
  g.phone_mask               as telefone_mascarado,
  g.phone_mask is not null   as tem_telefone,
  g.lgpd_consent_at,
  g.joined_at,
  s.opened_at,
  s.status                   as sessao_status
from public.session_guests g
join public.table_sessions s on s.id = g.session_id
where app.can_view_reports();

comment on view public.customer_directory is
  'Clientes com telefone MASCARADO. Valor cheio só por reveal_guest_phone (§10.9).';

/**
 * Mostra o telefone inteiro — e registra quem pediu.
 *
 * SECURITY DEFINER porque precisa passar por cima do GRANT de coluna acima. É
 * exatamente por isso que ela confere o papel na primeira linha: uma função
 * definer sem checagem é um buraco com nome bonito.
 *
 * O audit_log guarda o ID do cliente e nunca o telefone. Registrar o número no
 * log resolveria o rastro criando uma segunda cópia do dado pessoal, numa
 * tabela que a §10.8 exige que seja imutável — ou seja, uma cópia que ninguém
 * consegue apagar depois (spec §10.10: nunca logue dado pessoal).
 *
 * SQLSTATEs:
 *   45050 sem permissão para ver telefone
 *   45051 cliente não encontrado neste restaurante
 */
create or replace function public.reveal_guest_phone(p_guest_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_phone text;
begin
  if not app.has_any_role('owner', 'manager') then
    raise exception 'Sem permissão para ver o telefone completo'
      using errcode = '45050';
  end if;

  -- O filtro por restaurante é obrigatório e não é redundante: função DEFINER
  -- roda como dona da tabela e não passa por RLS. Sem esta linha, um id de
  -- outro restaurante devolveria o telefone.
  select phone into v_phone
    from public.session_guests
   where id = p_guest_id
     and restaurant_id = v_restaurante;

  if not found then
    raise exception 'Cliente não encontrado'
      using errcode = '45051';
  end if;

  if v_phone is null then
    return null;
  end if;

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after
  ) values (
    v_restaurante, 'staff', auth.uid(), 'customer.view_full_phone',
    'session_guest', p_guest_id,
    -- o QUE foi olhado, nunca o valor
    jsonb_build_object('revelado', true)
  );

  return v_phone;
end;
$$;

revoke all on function public.reveal_guest_phone(uuid) from public, anon;
grant execute on function public.reveal_guest_phone(uuid) to authenticated;

comment on function public.reveal_guest_phone(uuid) is
  'Telefone completo para gerente/dono, com registro em audit_log. O log guarda '
  'o id do cliente, nunca o número (spec §10.9, §10.10).';

-- =============================================================================
-- GRANTS
-- =============================================================================
-- Sem isto as views não existem para `authenticated` — foi o erro da migration
-- 0013, quando os privilégios padrão do Supabase deixaram 22 tabelas
-- inacessíveis e a RLS nunca chegou a ser avaliada.
-- =============================================================================
grant select on
  public.daily_sales,
  public.payment_mix,
  public.product_sales,
  public.kitchen_performance,
  public.rejected_items,
  public.promotion_performance,
  public.staff_money_actions,
  public.customer_directory
to authenticated;
