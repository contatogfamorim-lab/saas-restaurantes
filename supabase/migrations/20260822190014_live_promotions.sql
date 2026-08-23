-- =============================================================================
-- 0014 — view live_promotions
-- =============================================================================
-- "Esta promoção está valendo AGORA?" é regra de negócio delicada: janela de
-- datas, dia da semana, horário e estoque, tudo no fuso do restaurante.
--
-- Reimplementar isso em TypeScript criaria duas verdades que divergem no pior
-- momento possível — o cliente vendo "-50%" no cardápio e o pedido saindo com
-- preço cheio. A view mantém a regra dentro de `app.promotion_is_live()`, e a
-- aplicação só lê o resultado.
--
-- Consequência direta do critério de aceite (spec §16): "promoção de happy hour
-- entra e sai sozinha no horário, sem ninguém mexer". Ninguém mexe porque não
-- há nada para mexer — a view deixa de retornar a linha às 20h01.
-- =============================================================================

create view public.live_promotions
with (security_invoker = on) as
select
  p.id,
  p.restaurant_id,
  p.name,
  p.discount_type,
  p.discount_value,
  p.buy_quantity,
  p.pay_quantity,
  p.min_order_cents,
  p.priority,
  p.is_stackable,
  p.badge_label,
  p.badge_color,
  p.applies_to,
  p.time_from,
  p.time_to,
  p.days_of_week,
  p.ends_at,
  p.max_quantity,
  p.used_quantity,
  -- null = ilimitada. Só isto alimenta o selo "últimas unidades": escassez
  -- exibida tem que ser escassez real (spec §4).
  case when p.max_quantity is null then null
       else p.max_quantity - p.used_quantity
  end as remaining_quantity,
  r.timezone
from public.promotions p
join public.restaurants r on r.id = p.restaurant_id
where app.promotion_is_live(p, r.timezone);

comment on view public.live_promotions is
  'Promoções valendo NESTE INSTANTE. Fonte única da regra de vigência.';

-- Sem grant para anon: o cardápio público recebe o preço JÁ RESOLVIDO pelo
-- servidor, nunca as regras de promoção em si.
revoke all on public.live_promotions from anon, authenticated;
grant select on public.live_promotions to authenticated, service_role;
