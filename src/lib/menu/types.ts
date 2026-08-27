/**
 * Modelos de visão do cardápio.
 *
 * Deliberadamente NÃO são as linhas do banco. O que sai daqui é o que o
 * browser pode ver: preço já resolvido, promoção já aplicada, regra de
 * vigência já avaliada. `restaurant_id`, `station`, `promotion_id` e afins
 * ficam no servidor — o cliente não precisa deles e cada campo a mais é
 * superfície de ataque e byte de egress (spec §13.2).
 */

export type DietTag =
  | 'vegetariano'
  | 'vegano'
  | 'sem_gluten'
  | 'sem_lactose'
  | 'apimentado';

export type ProductBadge = 'novo' | 'mais_pedido' | 'picante' | 'da_casa';

export interface MenuModifierOption {
  id: string;
  name: string;
  priceDeltaCents: number;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: MenuModifierOption[];
}

export interface MenuPromotionBadge {
  id: string;
  label: string;
  color: string | null;
  /**
   * ISO do fim da janela de HOJE, só quando a janela é real.
   * `null` quando a promoção não tem hora para acabar — nesse caso não existe
   * contagem regressiva. Urgência inventada é proibida (spec §4).
   */
  endsAt: string | null;
  /** Só quando `max_quantity` está definido. Escassez exibida = escassez real. */
  remaining: number | null;
}

export interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  /** Preço a cobrar, com promoção já aplicada. */
  priceCents: number;
  /** Preço cheio, presente APENAS quando há desconto real. Vira o valor riscado. */
  originalPriceCents: number | null;
  imageUrl: string | null;
  prepMinutes: number;
  servesPeople: number;
  dietTags: DietTag[];
  badges: ProductBadge[];
  modifierGroups: MenuModifierGroup[];
  promotion: MenuPromotionBadge | null;
  categoryId: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  products: MenuProduct[];
}

export interface MenuRestaurant {
  id: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
  requirePhone: boolean;
  /** 0 = a casa não dá cashback, e a oferta some do fluxo de pedido. */
  cashbackPct: number;
  /** Os selos cadastrados pela casa, com cor e animação próprias. */
  selos: SeloDoCardapio[];
}

export interface MenuTable {
  id: string;
  label: string;
  area: string;
}

export interface MenuData {
  restaurant: MenuRestaurant;
  table: MenuTable;
  categories: MenuCategory[];
  /** Itens com promoção viva agora — alimenta o bloco "Hoje na casa". */
  promoted: MenuProduct[];
}

/**
 * Um selo, como a casa o cadastrou.
 *
 * Cor e animação vêm do banco, não de um mapa fixo no código: o conjunto deixou
 * de ser os quatro do enum e passou a ser o que cada restaurante quiser.
 */
export interface SeloDoCardapio {
  slug: string;
  label: string;
  color: string;
  animation: 'none' | 'pulse' | 'shine' | 'bounce';
}
