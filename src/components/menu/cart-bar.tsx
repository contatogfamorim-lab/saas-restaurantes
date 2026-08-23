'use client';

import { MinusIcon, PlusIcon, ShoppingBagIcon, Trash2Icon } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import {
  cartItemCount,
  cartTotalCents,
  lineTotalCents,
  type CartLine,
} from '@/lib/menu/cart';
import type { ConvidadoNaMesa } from '@/lib/menu/use-order-status';

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
  onChangeEater: (lineId: string, guestId: string | undefined) => void;
  onClear: () => void;
  onEnviar: () => void;
  enviando: boolean;
  erro: string | null;
  convidados: ConvidadoNaMesa[];
  /** Controlado pelo pai: o envio bem-sucedido precisa fechar esta folha. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CartBar({
  lines,
  onChangeQty,
  onChangeEater,
  onClear,
  onEnviar,
  enviando,
  erro,
  convidados,
  open,
  onOpenChange,
}: Props) {
  const setOpen = onOpenChange;

  const count = cartItemCount(lines);
  const total = cartTotalCents(lines);

  // Os chips de "para quem" só aparecem quando há mais de uma pessoa na mesa.
  // Com uma só, seria um passo a mais para responder o óbvio.
  const dividindo = convidados.length > 1;

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

          <ul className="divide-y overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+9rem)]">
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

                {dividindo && (
                  <div className="mt-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Para
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {convidados.map((g) => {
                        const escolhido = g.euMesmo
                          ? !line.eaterGuestId || line.eaterGuestId === g.id
                          : line.eaterGuestId === g.id;
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => onChangeEater(line.lineId, g.id)}
                            aria-pressed={escolhido}
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                              escolhido
                                ? 'border-primary bg-primary/15 font-medium text-primary'
                                : 'border-input text-muted-foreground',
                            )}
                          >
                            {g.euMesmo ? 'Eu' : g.nome}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

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
            {erro && (
              <p role="alert" className="mb-2 text-center text-[13px] text-destructive">
                {erro}
              </p>
            )}

            <div className="flex items-baseline justify-between">
              <span className="text-[15px] text-muted-foreground">Total</span>
              <span className="tabular text-xl font-semibold">{formatCents(total)}</span>
            </div>

            <button
              type="button"
              onClick={onEnviar}
              disabled={enviando}
              className="mt-3 h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              {enviando ? 'Enviando…' : 'Enviar pedido'}
            </button>
            <p className="mt-2 text-center text-[12px] text-muted-foreground">
              O garçom confere antes de ir para a cozinha.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
