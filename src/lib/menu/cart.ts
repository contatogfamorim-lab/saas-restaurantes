import type { MenuModifierGroup, MenuProduct } from './types';

/**
 * Carrinho — estado LOCAL do celular do cliente.
 *
 * Nada aqui é confiável, e nada aqui precisa ser: no envio (Etapa 3) o cliente
 * manda apenas `product_id`, `qty`, `modifier_option_ids[]` e `notes`, e o
 * servidor recalcula tudo do banco (spec §10.1). Os valores abaixo existem só
 * para a tela mostrar um total enquanto a pessoa monta o pedido.
 *
 * Se algum dia um valor monetário daqui aparecer num request body, o código
 * está errado — é o vetor número 1 de fraude em sistema de pedido.
 */

export interface CartModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDeltaCents: number;
}

export interface CartLine {
  /** Identidade da LINHA, não do produto: dois burgers com pontos diferentes coexistem. */
  lineId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  basePriceCents: number;
  modifiers: CartModifier[];
  qty: number;
  notes: string;
}

export function lineUnitCents(line: CartLine): number {
  return line.basePriceCents + line.modifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0);
}

export function lineTotalCents(line: CartLine): number {
  return lineUnitCents(line) * line.qty;
}

export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
}

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

/**
 * Duas linhas do mesmo produto se fundem só quando os modificadores E a
 * observação batem. "Sem cebola" e "com cebola" continuam separados — juntar
 * viraria prato errado na mesa.
 */
export function sameConfiguration(a: CartLine, b: CartLine): boolean {
  if (a.productId !== b.productId) return false;
  if (a.notes.trim() !== b.notes.trim()) return false;
  if (a.modifiers.length !== b.modifiers.length) return false;
  const ids = (line: CartLine) => line.modifiers.map((m) => m.optionId).sort().join('|');
  return ids(a) === ids(b);
}

export function addLine(lines: CartLine[], incoming: CartLine): CartLine[] {
  const existing = lines.find((l) => sameConfiguration(l, incoming));
  if (!existing) return [...lines, incoming];
  return lines.map((l) =>
    l.lineId === existing.lineId ? { ...l, qty: Math.min(20, l.qty + incoming.qty) } : l,
  );
}

export function setLineQty(lines: CartLine[], lineId: string, qty: number): CartLine[] {
  if (qty <= 0) return lines.filter((l) => l.lineId !== lineId);
  return lines.map((l) => (l.lineId === lineId ? { ...l, qty: Math.min(20, qty) } : l));
}

// ---------------------------------------------------------------------------
// Validação dos grupos de modificadores
// ---------------------------------------------------------------------------

export interface SelectionState {
  [groupId: string]: string[];
}

/**
 * O que ainda falta para o item poder ser adicionado.
 *
 * Devolve MENSAGEM, não booleano. O botão desabilitado sem explicação é o
 * ponto onde o cliente desiste do pedido — a spec §4 exige "mensagem clara do
 * que falta".
 */
export function missingRequirement(
  groups: MenuModifierGroup[],
  selection: SelectionState,
): string | null {
  for (const group of groups) {
    const chosen = selection[group.id]?.length ?? 0;

    if (group.isRequired && chosen === 0) {
      return `Escolha ${group.name.toLowerCase()}`;
    }
    if (chosen < group.minSelect) {
      const faltam = group.minSelect - chosen;
      return `Escolha mais ${faltam} em ${group.name.toLowerCase()}`;
    }
    if (chosen > group.maxSelect) {
      return `Escolha no máximo ${group.maxSelect} em ${group.name.toLowerCase()}`;
    }
  }
  return null;
}

/** Preço ao vivo enquanto a pessoa escolhe os modificadores (spec §4). */
export function previewUnitCents(
  product: MenuProduct,
  selection: SelectionState,
): number {
  let total = product.priceCents;
  for (const group of product.modifierGroups) {
    for (const optionId of selection[group.id] ?? []) {
      const option = group.options.find((o) => o.id === optionId);
      if (option) total += option.priceDeltaCents;
    }
  }
  return total;
}

export function buildLine(
  product: MenuProduct,
  selection: SelectionState,
  qty: number,
  notes: string,
): CartLine {
  const modifiers: CartModifier[] = [];
  for (const group of product.modifierGroups) {
    for (const optionId of selection[group.id] ?? []) {
      const option = group.options.find((o) => o.id === optionId);
      if (!option) continue;
      modifiers.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDeltaCents: option.priceDeltaCents,
      });
    }
  }

  return {
    lineId: crypto.randomUUID(),
    productId: product.id,
    name: product.name,
    imageUrl: product.imageUrl,
    basePriceCents: product.priceCents,
    modifiers,
    qty,
    notes: notes.trim().slice(0, 280),
  };
}
