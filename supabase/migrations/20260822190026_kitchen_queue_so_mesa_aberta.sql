-- =============================================================================
-- 0026 — kitchen_queue só mostra item de mesa ABERTA
-- =============================================================================
-- A view listava qualquer item em queued/preparing/ready, independente do
-- estado da comanda. Uma mesa encerrada com item ainda em produção deixava
-- prato fantasma na tela da cozinha — alguém cozinha, empurra para a passagem,
-- e não há mesa para entregar.
--
-- `release_table()` já cancela o que está em produção ao liberar. Mas depender
-- disso é depender de todo caminho futuro lembrar de fazer o mesmo. A cozinha
-- cozinha para mesa aberta; a view passa a dizer isso.
-- =============================================================================

create or replace view public.kitchen_queue
with (security_invoker = on) as
select
  oi.id                as item_id,
  oi.restaurant_id,
  oi.station,
  oi.status,
  oi.qty,
  oi.notes,
  oi.course,
  oi.queued_at,
  oi.started_at,
  p.name               as produto,
  p.prep_minutes,
  t.label              as mesa,
  g.display_name       as cliente,
  o.session_id,
  -- Do SERVIDOR, não do relógio do tablet: aparelho de cozinha erra a hora, e
  -- um cronômetro adiantado faz a equipe correr atrás de atraso que não existe.
  extract(epoch from (now() - oi.queued_at))::int  as na_fila_segundos,
  extract(epoch from (now() - oi.started_at))::int as em_preparo_segundos
from public.order_items oi
join public.orders o             on o.id = oi.order_id
join public.products p           on p.id = oi.product_id
join public.table_sessions s     on s.id = o.session_id
join public.restaurant_tables t  on t.id = s.table_id
left join public.session_guests g on g.id = oi.guest_id
where oi.status in ('queued', 'preparing', 'ready')
  and s.status in ('open', 'closing');

grant select on public.kitchen_queue to authenticated, service_role;

comment on view public.kitchen_queue is
  'Fila de produção por estação, apenas de mesas abertas. Item retido pela '
  'marcha (held) NÃO aparece: para a cozinha, ele ainda não existe.';
