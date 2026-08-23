import type { DietTag, ProductBadge } from './types';

/**
 * Rótulos curtos para os chips dietéticos.
 *
 * Curtos porque cabem numa tela de 375px ao lado do preço; escritos por
 * extenso onde há espaço (filtros), abreviados no card. "S/ GLÚTEN" é claro
 * para quem procura; um ícone de trigo cortado não é.
 */
export const DIET_LABELS: Record<DietTag, { short: string; long: string }> = {
  vegetariano: { short: 'VEG', long: 'Vegetariano' },
  vegano: { short: 'VEGANO', long: 'Vegano' },
  sem_gluten: { short: 'S/ GLÚTEN', long: 'Sem glúten' },
  sem_lactose: { short: 'S/ LACTOSE', long: 'Sem lactose' },
  apimentado: { short: 'PICANTE', long: 'Apimentado' },
};

export const DIET_ORDER: DietTag[] = [
  'vegetariano',
  'vegano',
  'sem_gluten',
  'sem_lactose',
  'apimentado',
];

export const PRODUCT_BADGE_LABELS: Record<ProductBadge, string> = {
  novo: 'NOVO',
  mais_pedido: 'MAIS PEDIDO',
  picante: 'PICANTE',
  da_casa: 'DA CASA',
};

/** "Serve 3 pessoas" / "Serve 1 pessoa" / "Serve 1 a 2" */
export function servesLabel(serves: number): string | null {
  if (serves <= 1) return null;
  if (Number.isInteger(serves)) return `Serve ${serves} pessoas`;
  return `Serve ${Math.floor(serves)} a ${Math.ceil(serves)}`;
}
