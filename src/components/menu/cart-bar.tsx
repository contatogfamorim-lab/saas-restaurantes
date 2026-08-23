'use client';

import { useState } from 'react';
import { MinusIcon, PlusIcon, ShoppingBagIcon, Trash2Icon } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { formatCents } from '@/lib/money';
import {
  cartItemCount,
  cartTotalCents,
  lineTotalCents,
  type CartLine,
} from '@/lib/menu/cart';

/**
 * Barra flutuante persistente do carrinho (spec §4).
 *
 * Fica acima da área do polegar e respeita `safe-area-inset-bottom` — no
 * iPhone, um botão colado no fim da tela cai atrás da barra de gestos e o
 * cliente toca três vezes sem entender por que não acontece nada.
 */
interface Props {
  lines: CartLine[];
  onChangeQty: (lineId: string, qty: number) => void;
  onClear: () => void;
}

export function CartBar({ lines, onChangeQty, onClear }: Props) {
  const [open, setOpen] = useState(false);

  const count = cartItemCount(lines);
  const total = cartTotalCents(lines);

  if (count === 0) return null;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex h-14 w-full items-center gap-3 rounded-xl bg-primary px-4 text-primary-foreground shadow-lg shadow-black/25 sm:mx-auto sm:max-w-lg"
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center">
            <ShoppingBagIcon className="size-5" />
            <span className="tabular absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary-foreground text-[11px] font-bold text-primary">
              {count}
            </span>
          </span>
          <span className="flex-1 text-left text-[15px] font-semibold">Ver pedido</span>
          <span className="tabular text-[15px] font-semibold">{formatCents(total)}</span>
        </button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <SheetTitle className="font-display text-xl">Seu pedido</SheetTitle>
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground active:bg-accent"
            >
              <Trash2Icon className="size-3.5" />
              Limpar
            </button>
          </div>

          <ul className="divide-y overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+8.5rem)]">
            {lines.map((line) => (
              <li key={line.lineId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-[16px] leading-tight">{line.name}</h3>

                    {line.modifiers.length > 0 && (
                      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                        {line.modifiers.map((m) => m.optionName).join(' · ')}
                      </p>
                    )}

                    {line.notes && (
                      <p className="mt-0.5 text-[12px] italic leading-snug text-muted-foreground">
                        “{line.notes}”
                      </p>
                    )}
                  </div>

                  <span className="tabular shrink-0 text-[14px] font-semibold">
                    {formatCents(lineTotalCents(line))}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-1 rounded-lg border border-input">
                  <button
                    type="button"
                    onClick={() => onChangeQty(line.lineId, line.qty - 1)}
                    aria-label={`Diminuir ${line.name}`}
                    className="flex size-10 items-center justify-center rounded-l-lg"
                  >
                    {line.qty === 1 ? (
                      <Trash2Icon className="size-4 text-muted-foreground" />
                    ) : (
                      <MinusIcon className="size-4" />
                    )}
                  </button>
                  <span className="tabular w-7 text-center text-[15px] font-semibold">
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeQty(line.lineId, line.qty + 1)}
                    disabled={line.qty >= 20}
                    aria-label={`Aumentar ${line.name}`}
                    className="flex size-10 items-center justify-center rounded-r-lg disabled:opacity-30"
                  >
                    <PlusIcon className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="absolute inset-x-0 bottom-0 border-t bg-popover px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] text-muted-foreground">Total</span>
              <span className="tabular text-xl font-semibold">{formatCents(total)}</span>
            </div>

            <button
              type="button"
              disabled
              className="mt-3 h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              Enviar pedido
            </button>
            <p className="mt-2 text-center text-[12px] text-muted-foreground">
              O envio entra na Etapa 3, junto com a identificação do cliente.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
