-- =============================================================================
-- 0031 — A passagem: o que está pronto esperando garçom (spec §5 e §6)
-- =============================================================================
-- O QUE ESTAVA FALTANDO
--
-- A cozinha já sabia avisar: o KDS tem o botão "Pronto", o item vira `ready`, o
-- card passa a dizer "Aguardando o garçom" e o Realtime acorda a tela do salão.
-- Tudo isso já funcionava.
--
-- O que não existia era o outro lado. No salão, "pronto" aparecia só como uma
-- tarja discreta no card da mesa — e abaixo de "Pedido novo" e "Chamou" na
-- ordem de prioridade, então uma mesa com pedido pendente escondia o prato
-- pronto por completo. O botão "Entreguei" existia, mas dentro da ficha da
-- mesa: para descobrir que havia comida na passagem, o garçom precisava abrir
-- mesa por mesa.
--
-- Na prática isso é o prato esfriando embaixo da lâmpada enquanto quem devia
-- levá-lo está do outro lado do salão. É o modo de falha mais comum de um
-- restaurante, e o sistema não estava ajudando em nada.
--
-- Esta view é a fila da passagem, na ordem que importa: quem ficou pronto
-- primeiro sai primeiro.
-- =============================================================================

create or replace view public.ready_pass
with (security_invoker = on) as
select
  oi.id                                              as item_id,
  oi.restaurant_id,
  s.id                                               as session_id,
  t.id                                               as table_id,
  t.label                                            as mesa,
  t.area,
  p.name                                             as produto,
  oi.qty,
  oi.station                                         as estacao,
  g.display_name                                     as cliente,
  oi.course                                          as tempo,
  oi.ready_at,
  -- Quanto tempo o prato está parado. É o número que decide a ordem e a cor:
  -- comida quente tem prazo, e o prazo começa quando a cozinha larga o prato.
  greatest(0, extract(epoch from (now() - oi.ready_at)))::int as esperando_segundos,
  -- Os modificadores acompanham porque a entrega é o último momento de pegar a
  -- troca: dois pratos iguais na passagem, um sem cebola, e quem leva precisa
  -- saber qual é qual antes de chegar na mesa.
  coalesce(
    (select array_agg(m.option_name order by m.created_at)
       from public.order_item_modifiers m
      where m.order_item_id = oi.id),
    array[]::text[]
  )                                                  as modificadores,
  oi.notes
from public.order_items oi
join public.orders o          on o.id = oi.order_id
join public.table_sessions s  on s.id = o.session_id
join public.restaurant_tables t on t.id = s.table_id
join public.products p        on p.id = oi.product_id
left join public.session_guests g on g.id = oi.guest_id
where oi.status = 'ready'
  -- Comanda fechada não tem passagem. Sem isto, um item que ficou `ready` numa
  -- mesa já liberada ficaria na fila para sempre, e a lista que deveria gritar
  -- vira uma lista que ninguém confia — que é o mesmo que não ter lista.
  and s.status in ('open', 'closing');

comment on view public.ready_pass is
  'Fila da passagem: itens prontos aguardando o garçom, do mais antigo para o '
  'mais novo. Só de comandas abertas (spec §5, §6).';

grant select on public.ready_pass to authenticated;
