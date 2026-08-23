-- =============================================================================
-- 0021 — session_totals reconhece o estado 'held'
-- =============================================================================
-- Item retido pela marcha JÁ foi aprovado pelo garçom: ele vai ser feito, só
-- não foi mandado ainda. Portanto é consumo, não "aguardando aprovação".
--
-- Deixá-lo em `pending_cents` faria o cliente ver o total da mesa cair quando o
-- garçom aprovasse e subir de novo na liberação do curso — um valor
-- oscilando sem que nada tivesse mudado de fato.
-- =============================================================================

create or replace view public.session_totals
with (security_invoker = on) as
with item_totals as (
  select
    oi.session_id,
    sum(oi.total_price_cents) filter (
      where oi.status in ('held', 'queued', 'preparing', 'ready', 'delivered')
    ) as billable_cents,
    sum(oi.total_price_cents) filter (
      where oi.status = 'pending'
    ) as pending_cents,
    sum(coalesce(oi.original_price_cents, oi.unit_price_cents) * oi.qty
        - oi.total_price_cents) filter (
      where oi.status in ('held', 'queued', 'preparing', 'ready', 'delivered')
        and oi.promotion_id is not null
    ) as promotion_discount_cents
  from (
    select oi.*, o.session_id
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
  ) oi
  group by oi.session_id
),
adjustments as (
  select
    session_id,
    coalesce(sum(amount_cents) filter (where type = 'discount'), 0) as discount_cents,
    bool_or(type = 'service_fee_waiver') as service_fee_waived
  from public.session_adjustments
  group by session_id
),
paid as (
  select session_id, coalesce(sum(amount_cents), 0) as paid_cents
  from public.payments
  group by session_id
)
select
  s.id                                            as session_id,
  s.restaurant_id,
  s.table_id,
  s.status,
  coalesce(it.billable_cents, 0)::int             as subtotal_cents,
  coalesce(it.pending_cents, 0)::int              as pending_cents,
  coalesce(it.promotion_discount_cents, 0)::int   as promotion_discount_cents,
  coalesce(adj.service_fee_waived, false)         as service_fee_waived,
  r.service_fee_pct,
  case
    when coalesce(adj.service_fee_waived, false) then 0
    else round(coalesce(it.billable_cents, 0) * r.service_fee_pct / 100.0)
  end::int                                        as service_fee_cents,
  coalesce(adj.discount_cents, 0)::int            as discount_cents,
  greatest(
    coalesce(it.billable_cents, 0)
    + case
        when coalesce(adj.service_fee_waived, false) then 0
        else round(coalesce(it.billable_cents, 0) * r.service_fee_pct / 100.0)
      end
    - coalesce(adj.discount_cents, 0),
    0
  )::int                                          as total_cents,
  coalesce(p.paid_cents, 0)::int                  as paid_cents,
  (
    greatest(
      coalesce(it.billable_cents, 0)
      + case
          when coalesce(adj.service_fee_waived, false) then 0
          else round(coalesce(it.billable_cents, 0) * r.service_fee_pct / 100.0)
        end
      - coalesce(adj.discount_cents, 0),
      0
    ) - coalesce(p.paid_cents, 0)
  )::int                                          as balance_cents
from public.table_sessions s
join public.restaurants r on r.id = s.restaurant_id
left join item_totals it on it.session_id = s.id
left join adjustments adj on adj.session_id = s.id
left join paid p on p.session_id = s.id;

grant select on public.session_totals to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Fila de aprovação, pronta para a tela do garçom (spec §5).
-- Uma view em vez de montar o JOIN na aplicação: a tela do salão é a mais
-- crítica em tempo de resposta, e ela recarrega o tempo todo.
-- -----------------------------------------------------------------------------
create view public.approval_queue
with (security_invoker = on) as
select
  o.id                as order_id,
  o.restaurant_id,
  o.session_id,
  o.created_at,
  t.id                as table_id,
  t.label             as table_label,
  t.area              as table_area,
  g.display_name      as guest_name,
  o.source,
  extract(epoch from (now() - o.created_at))::int as esperando_segundos
from public.orders o
join public.table_sessions s on s.id = o.session_id
join public.restaurant_tables t on t.id = s.table_id
left join public.session_guests g on g.id = o.guest_id
where o.status = 'pending_approval';

grant select on public.approval_queue to authenticated, service_role;
