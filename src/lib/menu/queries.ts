import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createPublicClient } from '@/lib/supabase/public';

import type {
  DietTag,
  MenuCategory,
  MenuData,
  MenuModifierGroup,
  MenuProduct,
  MenuPromotionBadge,
  ProductBadge,
} from './types';

/**
 * Carrega o cardápio de uma mesa a partir do `short_code` da etiqueta.
 *
 * Usa DOIS clients, de propósito:
 *
 *  - `admin` (service_role, ignora RLS) para resolver a mesa e ler as
 *    promoções. `restaurant_tables` não tem policy para anon justamente para
 *    que ninguém enumere os códigos das mesas (spec §10.4), e as regras de
 *    promoção não são assunto do cliente — ele recebe o preço já resolvido.
 *
 *  - `public` (anon, RLS ativa) para o cardápio em si. As policies já filtram
 *    disponibilidade e janela de horário, então o cardápio dinâmico da spec §4
 *    acontece no banco. Não existe `if` de horário nesta função, e portanto
 *    não existe `if` de horário errado.
 */
export async function loadMenu(shortCode: string): Promise<MenuData | null> {
  const admin = createAdminClient();

  const { data: table } = await admin
    .from('restaurant_tables')
    .select('id, label, area, active, restaurant_id')
    .eq('short_code', shortCode)
    .maybeSingle();

  if (!table || !table.active) return null;

  const { data: restaurant } = await admin
    .from('restaurants')
    .select('id, name, logo_url, brand_color, require_phone, timezone, active')
    .eq('id', table.restaurant_id as string)
    .maybeSingle();

  if (!restaurant || !restaurant.active) return null;

  const restaurantId = restaurant.id as string;
  const timezone = (restaurant.timezone as string) ?? 'America/Sao_Paulo';

  const supabase = createPublicClient();

  const [categoriesRes, productsRes, linksRes, groupsRes, optionsRes] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, sort_order')
      .eq('restaurant_id', restaurantId)
      .order('sort_order'),
    supabase
      .from('products')
      // literal único de propósito: o supabase-js infere o tipo do retorno a
      // partir da string do select, e concatenação apaga essa inferência
      .select('id, category_id, name, description, price_cents, image_url, prep_minutes, serves_people, diet_tags, badges, sort_order')
      .eq('restaurant_id', restaurantId)
      .order('sort_order'),
    supabase
      .from('product_modifier_groups')
      .select('product_id, group_id, sort_order')
      .eq('restaurant_id', restaurantId)
      .order('sort_order'),
    supabase
      .from('modifier_groups')
      .select('id, name, min_select, max_select, is_required, sort_order')
      .eq('restaurant_id', restaurantId)
      .order('sort_order'),
    supabase
      .from('modifier_options')
      .select('id, group_id, name, price_delta_cents, sort_order')
      .eq('restaurant_id', restaurantId)
      .order('sort_order'),
  ]);

  const categories = categoriesRes.data ?? [];
  const products = productsRes.data ?? [];

  // --- promoções vivas AGORA, resolvidas pela view (migration 0014) ---------
  const { data: livePromos } = await admin
    .from('live_promotions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('priority', { ascending: false });

  const promos = livePromos ?? [];
  const promoIds = promos.map((p) => p.id as string);

  const { data: targets } = promoIds.length
    ? await admin
        .from('promotion_targets')
        .select('promotion_id, target_type, target_id')
        .in('promotion_id', promoIds)
    : { data: [] as { promotion_id: string; target_type: string; target_id: string }[] };

  // --- montagem dos modificadores ------------------------------------------
  const optionsByGroup = new Map<string, { id: string; name: string; priceDeltaCents: number }[]>();
  for (const o of optionsRes.data ?? []) {
    const list = optionsByGroup.get(o.group_id as string) ?? [];
    list.push({
      id: o.id as string,
      name: o.name as string,
      priceDeltaCents: o.price_delta_cents as number,
    });
    optionsByGroup.set(o.group_id as string, list);
  }

  const groupsById = new Map<string, MenuModifierGroup>();
  for (const g of groupsRes.data ?? []) {
    groupsById.set(g.id as string, {
      id: g.id as string,
      name: g.name as string,
      minSelect: g.min_select as number,
      maxSelect: g.max_select as number,
      isRequired: g.is_required as boolean,
      options: optionsByGroup.get(g.id as string) ?? [],
    });
  }

  const groupsByProduct = new Map<string, MenuModifierGroup[]>();
  for (const link of linksRes.data ?? []) {
    const group = groupsById.get(link.group_id as string);
    // grupo sem nenhuma opção disponível não deve virar um passo vazio na tela
    if (!group || group.options.length === 0) continue;
    const list = groupsByProduct.get(link.product_id as string) ?? [];
    list.push(group);
    groupsByProduct.set(link.product_id as string, list);
  }

  // --- resolução de preço ---------------------------------------------------
  const byCategory = new Map<string, MenuProduct[]>();
  const promoted: MenuProduct[] = [];

  for (const p of products) {
    const productId = p.id as string;
    const categoryId = p.category_id as string;
    const listPrice = p.price_cents as number;

    const winner = bestPromotionFor(promos, targets ?? [], productId, categoryId);
    const resolved = applyPromotion(listPrice, winner);

    const product: MenuProduct = {
      id: productId,
      name: p.name as string,
      description: (p.description as string | null) ?? null,
      priceCents: resolved.priceCents,
      originalPriceCents: resolved.originalPriceCents,
      imageUrl: (p.image_url as string | null) ?? null,
      prepMinutes: p.prep_minutes as number,
      servesPeople: Number(p.serves_people),
      dietTags: ((p.diet_tags as DietTag[] | null) ?? []) as DietTag[],
      badges: ((p.badges as ProductBadge[] | null) ?? []) as ProductBadge[],
      modifierGroups: groupsByProduct.get(productId) ?? [],
      promotion: winner ? toBadge(winner, timezone) : null,
      categoryId,
    };

    const list = byCategory.get(categoryId) ?? [];
    list.push(product);
    byCategory.set(categoryId, list);

    if (product.promotion) promoted.push(product);
  }

  const menuCategories: MenuCategory[] = categories
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      products: byCategory.get(c.id as string) ?? [],
    }))
    // categoria sem nenhum produto disponível não vira seção vazia no cardápio
    .filter((c) => c.products.length > 0);

  return {
    restaurant: {
      id: restaurantId,
      name: restaurant.name as string,
      logoUrl: (restaurant.logo_url as string | null) ?? null,
      brandColor: (restaurant.brand_color as string) ?? '#D97A28',
      requirePhone: Boolean(restaurant.require_phone),
    },
    table: {
      id: table.id as string,
      label: table.label as string,
      area: table.area as string,
    },
    categories: menuCategories,
    promoted,
  };
}

type LivePromo = Record<string, unknown>;
type Target = { promotion_id: string; target_type: string; target_id: string };

/**
 * Escolhe UMA promoção por produto.
 *
 * Não cumulativa por padrão (spec §12.12): com duas válidas no mesmo item,
 * vence a de maior `priority`. Promoção acumulando por acidente já quebrou o
 * caixa de muita casa, então o padrão aqui é sempre "só a melhor".
 *
 * Alvo de produto ganha de alvo de categoria com a mesma prioridade — o mais
 * específico é o que o dono quis dizer.
 */
function bestPromotionFor(
  promos: LivePromo[],
  targets: Target[],
  productId: string,
  categoryId: string,
): LivePromo | null {
  const candidates = promos.filter((promo) => {
    const id = promo.id as string;
    // promoção aplicada pelo garçom não entra sozinha no cardápio
    if (promo.applies_to !== 'auto') return false;
    if ((promo.remaining_quantity as number | null) === 0) return false;
    return targets.some(
      (t) =>
        t.promotion_id === id &&
        ((t.target_type === 'product' && t.target_id === productId) ||
          (t.target_type === 'category' && t.target_id === categoryId)),
    );
  });

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const byPriority = (b.priority as number) - (a.priority as number);
    if (byPriority !== 0) return byPriority;
    const specificity = (promo: LivePromo) =>
      targets.some((t) => t.promotion_id === promo.id && t.target_type === 'product') ? 1 : 0;
    return specificity(b) - specificity(a);
  })[0];
}

/**
 * Aplica a promoção ao preço de tabela.
 *
 * `originalPriceCents` só é preenchido quando há desconto REAL no preço
 * unitário. É ele que vira o valor riscado na tela, e riscar um preço que a
 * casa nunca praticou é publicidade enganosa (spec §4).
 *
 * `buy_x_pay_y` e `free_item` não mexem no preço unitário — dependem da
 * composição do carrinho. Rendem selo, nunca valor riscado.
 */
function applyPromotion(
  listPriceCents: number,
  promo: LivePromo | null,
): { priceCents: number; originalPriceCents: number | null } {
  if (!promo) return { priceCents: listPriceCents, originalPriceCents: null };

  let price = listPriceCents;

  if (promo.discount_type === 'fixed_price') {
    price = Math.round(Number(promo.discount_value));
  } else if (promo.discount_type === 'percent') {
    price = Math.round(listPriceCents * (1 - Number(promo.discount_value) / 100));
  }

  price = Math.max(0, price);

  return price < listPriceCents
    ? { priceCents: price, originalPriceCents: listPriceCents }
    : { priceCents: listPriceCents, originalPriceCents: null };
}

function toBadge(promo: LivePromo, timezone: string): MenuPromotionBadge {
  return {
    id: promo.id as string,
    label: (promo.badge_label as string | null) ?? 'PROMOÇÃO',
    color: (promo.badge_color as string | null) ?? null,
    endsAt: windowEndsAt(promo, timezone),
    remaining: (promo.remaining_quantity as number | null) ?? null,
  };
}

/**
 * Quando a janela realmente acaba, em ISO. `null` quando não acaba hoje.
 *
 * Só existe contagem regressiva quando existe hora para acabar. "Happy hour
 * até as 20h" é informação; um relógio correndo numa promoção sem fim é
 * urgência inventada, e a spec §4 proíbe.
 */
function windowEndsAt(promo: LivePromo, timezone: string): string | null {
  const timeTo = promo.time_to as string | null;
  const timeFrom = promo.time_from as string | null;
  const endsAt = promo.ends_at as string | null;

  const candidates: number[] = [];
  if (endsAt) candidates.push(new Date(endsAt).getTime());

  if (timeTo) {
    const [hh, mm] = timeTo.split(':').map(Number);
    const now = new Date();
    const { year, month, day, hour, minute } = zonedParts(now, timezone);

    // janela que cruza a meia-noite (17h–02h) termina no dia seguinte
    const crossesMidnight = Boolean(timeFrom && timeTo < timeFrom);
    const nowMinutes = hour * 60 + minute;
    const endMinutes = hh * 60 + mm;
    const addDay = crossesMidnight && nowMinutes >= endMinutes ? 1 : 0;

    candidates.push(zonedInstant(year, month, day + addDay, hh, mm, timezone));
  }

  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates)).toISOString();
}

function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(at)
    .filter((p) => p.type !== 'literal');

  const map = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour % 24,
    minute: map.minute,
    second: map.second,
  };
}

/** Converte uma hora de parede naquele fuso para o instante UTC correspondente. */
function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = zonedParts(new Date(guess), timeZone);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return guess - (asIfUTC - guess);
}
