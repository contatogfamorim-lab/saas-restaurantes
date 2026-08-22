-- =============================================================================
-- 0011 — Views derivadas
-- =============================================================================
-- Todas com security_invoker = on: a view roda com as permissões de QUEM
-- consulta, então a RLS das tabelas de base continua valendo. É o oposto de
-- uma view SECURITY DEFINER, que contornaria RLS em silêncio (spec §10.2).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- session_totals — o total NUNCA é armazenado (spec §3, regra 3).
-- É sempre derivado dos itens, da taxa e dos pagamentos.
-- -----------------------------------------------------------------------------
create view public.session_totals
with (security_invoker = on) as
with item_totals as (
  select
    oi.session_id,
    sum(oi.total_price_cents) filter (
      where oi.status in ('queued', 'preparing', 'ready', 'delivered')
    ) as billable_cents,
    sum(oi.total_price_cents) filter (
      where oi.status = 'pending'
    ) as pending_cents,
    sum(coalesce(oi.original_price_cents, oi.unit_price_cents) * oi.qty
        - oi.total_price_cents) filter (
      where oi.status in ('queued', 'preparing', 'ready', 'delivered')
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

comment on view public.session_totals is
  'Total derivado dos itens. Fechamento normal exige balance_cents = 0.';

-- -----------------------------------------------------------------------------
-- Métricas de tempo (spec §3). Os timestamps são gravados; as durações,
-- calculadas aqui — nunca desnormalizadas.
-- -----------------------------------------------------------------------------
create view public.order_item_timings
with (security_invoker = on) as
select
  oi.id                                   as order_item_id,
  oi.restaurant_id,
  o.session_id,
  oi.product_id,
  p.name                                  as product_name,
  p.prep_minutes,
  oi.station,
  oi.status,
  oi.queued_at,
  oi.started_at,
  oi.ready_at,
  oi.delivered_at,
  extract(epoch from (oi.started_at - oi.queued_at))::int  as fila_seconds,
  extract(epoch from (oi.ready_at  - oi.started_at))::int  as producao_seconds,
  -- este é o número que o cliente sente
  extract(epoch from (oi.ready_at  - oi.queued_at))::int   as total_seconds,
  -- atrasado = passou de 1,5× o tempo previsto e ainda não ficou pronto
  (oi.status in ('queued', 'preparing')
   and oi.queued_at is not null
   and now() > oi.queued_at + (p.prep_minutes * 1.5) * interval '1 minute'
  )                                       as is_late
from public.order_items oi
join public.orders o   on o.id = oi.order_id
join public.products p on p.id = oi.product_id;

-- -----------------------------------------------------------------------------
-- Estado de cada mesa para o mapa do salão (spec §5).
-- -----------------------------------------------------------------------------
create view public.table_status
with (security_invoker = on) as
select
  t.id                as table_id,
  t.restaurant_id,
  t.label,
  t.area,
  t.seats,
  t.short_code,
  s.id                as session_id,
  s.opened_at,
  s.guest_count,
  st.total_cents,
  st.balance_cents,
  exists (
    select 1 from public.orders o
     where o.session_id = s.id and o.status = 'pending_approval'
  )                   as has_pending_approval,
  exists (
    select 1 from public.waiter_calls wc
     where wc.session_id = s.id and wc.status = 'open'
  )                   as has_open_call,
  exists (
    select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.session_id = s.id
       and oi.status = 'ready'
       and oi.ready_at < now() - interval '3 minutes'
  )                   as has_ready_waiting,
  exists (
    select 1 from public.order_item_timings ti
     where ti.session_id = s.id and ti.is_late
  )                   as has_late_item,
  -- "sem bebida": ≥2 itens de comida e nenhum do bar
  (
    (select count(*) from public.order_items oi
       join public.orders o on o.id = oi.order_id
      where o.session_id = s.id and oi.station = 'cozinha'
        and oi.status <> 'cancelled') >= 2
    and not exists (
      select 1 from public.order_items oi
        join public.orders o on o.id = oi.order_id
       where o.session_id = s.id and oi.station = 'bar'
         and oi.status <> 'cancelled')
  )                   as has_no_drinks,
  -- "mesa indecisa": aberta há mais de 8 min sem nenhum pedido
  (
    s.opened_at < now() - interval '8 minutes'
    and not exists (select 1 from public.orders o where o.session_id = s.id)
  )                   as is_undecided
from public.restaurant_tables t
left join public.table_sessions s
       on s.table_id = t.id and s.status in ('open', 'closing')
left join public.session_totals st on st.session_id = s.id
where t.active;
