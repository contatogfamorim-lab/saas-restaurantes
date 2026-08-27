'use client';

import { useState } from 'react';
import { MinusIcon, PlusIcon } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { formatCents, discountPercent } from '@/lib/money';
import { servesLabel } from '@/lib/menu/labels';
import {
  buildLine,
  missingRequirement,
  previewUnitCents,
  type CartLine,
  type SelectionState,
} from '@/lib/menu/cart';
import type { MenuProduct, RestricaoDoCardapio } from '@/lib/menu/types';

import { ProductImage } from './product-image';
import { PromoCountdown } from './promo-countdown';

/**
 * Detalhe do produto em bottom sheet (spec §4).
 *
 * A regra que decide se o pedido acontece está no rodapé: enquanto um grupo
 * obrigatório não estiver satisfeito, o botão fica desabilitado E diz o que
 * falta. Botão morto sem explicação é onde o cliente desiste.
 */
interface Props {
  product: MenuProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Definições das restrições da casa — cor e nome inteiro. */
  restricoes: RestricaoDoCardapio[];
  onAdd: (line: CartLine) => void;
}

export function ProductSheet({ product, open, onOpenChange, onAdd, restricoes }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-hidden rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
      >
        {/*
          `key` no produto: trocar de prato REMONTA o corpo, e o estado nasce
          limpo por construção. Resetar com useEffect faria o mesmo, mas em um
          render extra e com uma janela em que a tela mostra a escolha do prato
          anterior — "mal passado" vazando para o próximo pedido vira prato
          devolvido na mesa.
        */}
        {product && (
          <ProductSheetBody
            key={product.id}
            product={product}
            onAdd={onAdd}
            restricoes={restricoes}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProductSheetBody({
  product,
  onAdd,
  restricoes,
  onClose,
}: {
  product: MenuProduct;
  restricoes: RestricaoDoCardapio[];
  onAdd: (line: CartLine) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<SelectionState>(() => {
    const initial: SelectionState = {};
    for (const group of product.modifierGroups) initial[group.id] = [];
    return initial;
  });
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  const unitCents = previewUnitCents(product, selection);
  const missing = missingRequirement(product.modifierGroups, selection);
  const canAdd = missing === null;
  const serves = servesLabel(product.servesPeople);
  const hasDiscount = product.originalPriceCents !== null;

  function toggle(groupId: string, optionId: string, maxSelect: number) {
    setSelection((prev) => {
      const current = prev[groupId] ?? [];
      const isOn = current.includes(optionId);

      if (isOn) return { ...prev, [groupId]: current.filter((id) => id !== optionId) };

      // grupo de escolha única troca em vez de acumular — é o comportamento
      // que a pessoa espera de um radio, sem precisar desmarcar antes
      if (maxSelect === 1) return { ...prev, [groupId]: [optionId] };

      if (current.length >= maxSelect) return prev;
      return { ...prev, [groupId]: [...current, optionId] };
    });
  }

  function handleAdd() {
    if (!canAdd) return;
    onAdd(buildLine(product, selection, qty, notes));
    onClose();
  }

  return (
    <>
        <div className="overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+7rem)]">
          <div className="relative aspect-[5/3] w-full bg-muted">
            <ProductImage
              name={product.name}
              url={product.imageUrl}
              priority
              sizes="(max-width: 640px) 100vw, 512px"
            />
            {product.promotion && (
              <span
                className="absolute left-3 top-3 rounded px-2 py-1 text-[11px] font-bold tracking-wide text-white shadow"
                style={{ backgroundColor: product.promotion.color ?? 'var(--primary)' }}
              >
                {product.promotion.label}
              </span>
            )}
          </div>

          <div className="px-4 pt-4">
            <SheetTitle className="font-display text-2xl leading-tight">
              {product.name}
            </SheetTitle>

            {product.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {product.description}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {serves && <span className="text-xs text-muted-foreground">{serves}</span>}
              {/* Na ficha aberta vai o nome INTEIRO — "Sem glúten", não
                  "S/ GLÚTEN". Aqui há espaço, e é onde a pessoa confere antes
                  de pedir. Abreviação serve à lista, não à decisão. */}
              {product.dietTags.map((slug) => {
                const r = restricoes.find((x) => x.slug === slug);
                if (!r) return null;
                return (
                  <span
                    key={slug}
                    className="rounded-sm px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{
                      color: r.color,
                      background: `color-mix(in oklab, ${r.color} 15%, transparent)`,
                    }}
                  >
                    {r.labelLong}
                  </span>
                );
              })}
            </div>

            {product.promotion && (
              <PromoCountdown
                endsAt={product.promotion.endsAt}
                remaining={product.promotion.remaining}
              />
            )}

            {hasDiscount && (
              <p className="mt-3 text-sm">
                <span className="tabular text-muted-foreground line-through">
                  {formatCents(product.originalPriceCents!)}
                </span>{' '}
                <span className="font-semibold text-primary">
                  economize {discountPercent(product.originalPriceCents!, product.priceCents)}%
                </span>
              </p>
            )}
          </div>

          {product.modifierGroups.map((group) => {
            const chosen = selection[group.id] ?? [];
            const single = group.maxSelect === 1;
            const atMax = chosen.length >= group.maxSelect;

            return (
              <section key={group.id} className="mt-6">
                <header className="flex items-baseline justify-between px-4">
                  <h4 className="text-sm font-semibold">{group.name}</h4>
                  <span className="text-[11px] text-muted-foreground">
                    {group.isRequired
                      ? 'Obrigatório'
                      : single
                        ? 'Opcional'
                        : `Até ${group.maxSelect}`}
                  </span>
                </header>

                <ul className="mt-1">
                  {group.options.map((option) => {
                    const isOn = chosen.includes(option.id);
                    const blocked = !isOn && atMax && !single;

                    return (
                      <li key={option.id}>
                        <button
                          type="button"
                          disabled={blocked}
                          onClick={() => toggle(group.id, option.id, group.maxSelect)}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                            'active:bg-accent/60 disabled:opacity-40',
                            isOn && 'bg-accent/40',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'flex size-5 shrink-0 items-center justify-center border-2 transition-colors',
                              single ? 'rounded-full' : 'rounded',
                              isOn ? 'border-primary bg-primary' : 'border-input',
                            )}
                          >
                            {isOn && (
                              <span
                                className={cn(
                                  'bg-primary-foreground',
                                  single ? 'size-1.5 rounded-full' : 'size-2 rounded-[1px]',
                                )}
                              />
                            )}
                          </span>

                          <span className="min-w-0 flex-1 text-sm">{option.name}</span>

                          {option.priceDeltaCents !== 0 && (
                            <span className="tabular shrink-0 text-sm text-muted-foreground">
                              {option.priceDeltaCents > 0 ? '+' : '−'}
                              {formatCents(Math.abs(option.priceDeltaCents))}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <section className="mt-6 px-4">
            <label htmlFor="obs" className="text-sm font-semibold">
              Alguma observação?
            </label>
            <textarea
              id="obs"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={280}
              rows={2}
              placeholder="Ex: ponto da carne bem passado, sem sal"
              className="mt-2 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {notes.length}/280
            </p>
          </section>
        </div>

        {/* Rodapé fixo: quantidade e ação principal ficam na zona do polegar */}
        <div className="absolute inset-x-0 bottom-0 border-t bg-popover px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
          {missing && (
            <p role="status" className="mb-2 text-center text-[13px] text-primary">
              {missing}
            </p>
          )}

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-input">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                aria-label="Diminuir quantidade"
                className="flex size-11 items-center justify-center rounded-l-lg disabled:opacity-30"
              >
                <MinusIcon className="size-4" />
              </button>
              <span className="tabular w-7 text-center text-base font-semibold" aria-live="polite">
                {qty}
              </span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(20, q + 1))}
                disabled={qty >= 20}
                aria-label="Aumentar quantidade"
                className="flex size-11 items-center justify-center rounded-r-lg disabled:opacity-30"
              >
                <PlusIcon className="size-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleAdd}
              disabled={!canAdd}
              className="flex h-12 flex-1 items-center justify-between gap-2 rounded-lg bg-primary px-4 text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <span className="text-[15px] font-semibold">Adicionar</span>
              <span className="tabular text-[15px] font-semibold">
                {formatCents(unitCents * qty)}
              </span>
            </button>
          </div>
        </div>
    </>
  );
}
