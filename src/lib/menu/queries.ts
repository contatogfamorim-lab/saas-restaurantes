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
 *  - `admin` (service_role, ignora RLS) para resolver a mesa e ler os preços
 *    vigentes. `restaurant_tables` não tem policy para anon justamente para que
 *    ninguém enumere os códigos das mesas (spec §10.4).
 *
 *  - `public` (anon, RLS ativa) para o cardápio em si. As policies já filtram
 *    disponibilidade e janela de horário, então o cardápio dinâmico da spec §4
 *    acontece no banco. Não existe `if` de horário nesta função, e portanto não
 *    existe `if` de horário errado.
 *
 * O PREÇO vem inteiro da view `product_effective_prices` — a mesma que a função
 * `create_guest_order` consulta ao lançar o item. É isso que sustenta o
 * critério da spec §16: "o preço exibido no cardápio é sempre igual ao preço
 * cobrado na conta". Resolver promoção aqui em TypeScript criaria uma segunda
 * verdade, e a divergência apareceria no fechamento da conta.
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
    .eq('id', table.restaurant_id)
    .maybeSingle();

  if (!restaurant || !restaurant.active) return null;

  const restaurantId = restaurant.id;
  const timezone = restaurant.timezone ?? 'America/Sao_Paulo';

  const supabase = createPublicClient();

  const [categoriesRes, productsRes, linksRes, groupsRes, optionsRes, pricesRes] =
    await Promise.all([
      supabase
        .from('categories')
        .select('id, name, sort_order')
        .eq('restaurant_id', restaurantId)
        .order('sort_order'),
      supabase
        .from('products')
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
      // FONTE ÚNICA do preço — a mesma que a criação do pedido consulta
      admin
        .from('product_effective_prices')
        .select('*')
        .eq('restaurant_id', restaurantId),
    ]);

  const categories = categoriesRes.data ?? [];
  const products = productsRes.data ?? [];
  const precos = new Map((pricesRes.data ?? []).map((p) => [p.product_id as string, p]));

  // `products.image_url` guarda o CAMINHO no bucket, não a URL inteira — assim
  // o mesmo dado serve local, staging e produção sem reescrita (migration 0015).
  const publicUrl = (value: string | null): string | null => {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return supabase.storage.from('product-photos').getPublicUrl(value).data.publicUrl;
  };

  // --- modificadores ---------------------------------------------------------
  const optionsByGroup = new Map<string, MenuModifierGroup['options']>();
  for (const o of optionsRes.data ?? []) {
    const list = optionsByGroup.get(o.group_id) ?? [];
    list.push({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents });
    optionsByGroup.set(o.group_id, list);
  }

  const groupsById = new Map<string, MenuModifierGroup>();
  for (const g of groupsRes.data ?? []) {
    groupsById.set(g.id, {
      id: g.id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      isRequired: g.is_required,
      options: optionsByGroup.get(g.id) ?? [],
    });
  }

  const groupsByProduct = new Map<string, MenuModifierGroup[]>();
  for (const link of linksRes.data ?? []) {
    const group = groupsById.get(link.group_id);
    // grupo sem nenhuma opção disponível não deve virar um passo vazio na tela
    if (!group || group.options.length === 0) continue;
    const list = groupsByProduct.get(link.product_id) ?? [];
    list.push(group);
    groupsByProduct.set(link.product_id, list);
  }

  // --- montagem --------------------------------------------------------------
  const byCategory = new Map<string, MenuProduct[]>();
  const promoted: MenuProduct[] = [];

  for (const p of products) {
    const preco = precos.get(p.id);
    const priceCents = preco?.effective_price_cents ?? p.price_cents;
    const listPrice = preco?.list_price_cents ?? p.price_cents;
    const temDesconto = Boolean(preco?.promotion_id) && priceCents < listPrice;

    const product: MenuProduct = {
      id: p.id,
      name: p.name,
      description: p.description,
      priceCents,
      // só é preenchido quando há desconto REAL — riscar preço que a casa nunca
      // praticou é publicidade enganosa (spec §4)
      originalPriceCents: temDesconto ? listPrice : null,
      imageUrl: publicUrl(p.image_url),
      prepMinutes: p.prep_minutes,
      servesPeople: Number(p.serves_people),
      dietTags: (p.diet_tags ?? []) as DietTag[],
      badges: (p.badges ?? []) as ProductBadge[],
      modifierGroups: groupsByProduct.get(p.id) ?? [],
      promotion: preco?.promotion_id ? toBadge(preco, timezone) : null,
      categoryId: p.category_id,
    };

    const list = byCategory.get(p.category_id) ?? [];
    list.push(product);
    byCategory.set(p.category_id, list);

    if (product.promotion) promoted.push(product);
  }

  const menuCategories: MenuCategory[] = categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      products: byCategory.get(c.id) ?? [],
    }))
    // categoria sem nenhum produto disponível não vira seção vazia no cardápio
    .filter((c) => c.products.length > 0);

  return {
    restaurant: {
      id: restaurantId,
      name: restaurant.name,
      logoUrl: restaurant.logo_url,
      brandColor: restaurant.brand_color ?? '#D97A28',
      requirePhone: Boolean(restaurant.require_phone),
    },
    table: {
      id: table.id,
      label: table.label,
      area: table.area,
    },
    categories: menuCategories,
    promoted,
  };
}

type PrecoVigente = {
  promotion_id: string | null;
  badge_label: string | null;
  badge_color: string | null;
  time_from: string | null;
  time_to: string | null;
  ends_at: string | null;
  remaining_quantity: number | null;
};

function toBadge(preco: PrecoVigente, timezone: string): MenuPromotionBadge {
  return {
    id: preco.promotion_id!,
    label: preco.badge_label ?? 'PROMOÇÃO',
    color: preco.badge_color,
    endsAt: windowEndsAt(preco, timezone),
    remaining: preco.remaining_quantity,
  };
}

/**
 * Quando a janela realmente acaba, em ISO. `null` quando não acaba hoje.
 *
 * Só existe contagem regressiva quando existe hora para acabar. "Happy hour até
 * as 20h" é informação; um relógio correndo numa promoção sem fim é urgência
 * inventada, e a spec §4 proíbe.
 */
function windowEndsAt(preco: PrecoVigente, timezone: string): string | null {
  const candidates: number[] = [];
  if (preco.ends_at) candidates.push(new Date(preco.ends_at).getTime());

  if (preco.time_to) {
    const [hh, mm] = preco.time_to.split(':').map(Number);
    const { year, month, day, hour, minute } = zonedParts(new Date(), timezone);

    // janela que cruza a meia-noite (17h–02h) termina no dia seguinte
    const crossesMidnight = Boolean(preco.time_from && preco.time_to < preco.time_from);
    const addDay = crossesMidnight && hour * 60 + minute >= hh * 60 + mm ? 1 : 0;

    candidates.push(zonedInstant(year, month, day + addDay, hh, mm, timezone));
  }

  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null;
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
