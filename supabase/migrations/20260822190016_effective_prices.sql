-- =============================================================================
-- 0016 — view product_effective_prices
-- =============================================================================
-- FONTE ÚNICA do preço a cobrar.
--
-- Critério de aceite da spec §16: "preço exibido no cardápio é sempre igual ao
-- preço cobrado na conta". Isso só é garantível se existir UM lugar que
-- responde "quanto custa este produto agora" — o cardápio e a criação do pedido
-- perguntam para o mesmo lugar, e não há como divergirem.
--
-- Resolver promoção em TypeScript no cardápio e em SQL no pedido produziria
-- exatamente o bug que a spec proíbe: cliente vê R$ 39, comanda fecha em R$ 52.
-- =============================================================================

create view public.product_effective_prices
with (security_invoker = on) as
select
  p.id                        as product_id,
  p.restaurant_id,
  p.category_id,
  p.price_cents               as list_price_cents,
  promo.id                    as promotion_id,
  promo.badge_label,
  promo.badge_color,
  promo.time_from,
  promo.time_to,
  promo.ends_at,
  promo.remaining_quantity,
  promo.max_quantity,
  promo.discount_type,
  -- O preço final. `greatest(0, ...)` porque desconto configurado errado não
  -- pode virar valor negativo na comanda.
  case
    when promo.id is null then p.price_cents
    when promo.discount_type = 'fixed_price'
      then greatest(0, round(promo.discount_value)::int)
    when promo.discount_type = 'percent'
      then greatest(0, round(p.price_cents * (1 - promo.discount_value / 100.0))::int)
    -- buy_x_pay_y e free_item dependem da composição do carrinho: rendem selo,
    -- nunca alteram o preço unitário
    else p.price_cents
  end                         as effective_price_cents
from public.products p
left join lateral (
  select lp.*, pt.target_type
  from public.live_promotions lp
  join public.promotion_targets pt on pt.promotion_id = lp.id
  where lp.restaurant_id = p.restaurant_id
    -- promoção do garçom não entra sozinha; é aplicada à mão (spec §12.12)
    and lp.applies_to = 'auto'
    and (lp.remaining_quantity is null or lp.remaining_quantity > 0)
    and (
      (pt.target_type = 'product'  and pt.target_id = p.id) or
      (pt.target_type = 'category' and pt.target_id = p.category_id)
    )
  -- Não cumulativa: vence a de maior prioridade. Empatou, o alvo mais
  -- específico ganha — se o dono mirou este produto, foi ele que quis dizer.
  order by lp.priority desc, (pt.target_type = 'product') desc, lp.id
  limit 1
) promo on true
where p.archived_at is null;

comment on view public.product_effective_prices is
  'Preço vigente por produto, com a promoção já resolvida. O cardápio e a '
  'criação do pedido leem daqui — é o que garante que o preço exibido seja o '
  'preço cobrado (spec §16).';

-- Sem anon: o cardápio público recebe o preço já resolvido pelo servidor.
revoke all on public.product_effective_prices from anon, authenticated;
grant select on public.product_effective_prices to authenticated, service_role;
