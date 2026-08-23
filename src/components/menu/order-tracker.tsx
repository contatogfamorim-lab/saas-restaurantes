'use client';

import { CheckIcon, ChefHatIcon, ClockIcon, WifiOffIcon, XIcon } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import type { ItemAcompanhado, TotaisComanda } from '@/lib/menu/use-order-status';

/**
 * Acompanhamento do pedido: aguardando → em preparo → pronto → entregue.
 *
 * "Aguardando" é honesto sobre o que está acontecendo: o pedido está na fila do
 * garçom, não na cozinha. Nada vai para a produção antes de um humano aprovar
 * (spec §16), e esconder isso do cliente geraria a pergunta "cadê meu lanche?"
 * dirigida à pessoa errada.
 */

const ETAPAS: Record<string, { rotulo: string; passo: number; icone: typeof ClockIcon }> = {
  pending: { rotulo: 'Aguardando o garçom conferir', passo: 0, icone: ClockIcon },
  queued: { rotulo: 'Na fila da cozinha', passo: 1, icone: ChefHatIcon },
  preparing: { rotulo: 'Em preparo', passo: 2, icone: ChefHatIcon },
  ready: { rotulo: 'Pronto, saindo', passo: 3, icone: CheckIcon },
  delivered: { rotulo: 'Entregue', passo: 4, icone: CheckIcon },
  cancelled: { rotulo: 'Cancelado', passo: -1, icone: XIcon },
  out_of_stock: { rotulo: 'Acabou', passo: -1, icone: XIcon },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itens: ItemAcompanhado[];
  totais: TotaisComanda | null;
  offline: boolean;
  temMaisDeUmaPessoa: boolean;
}

export function OrderTracker({
  open,
  onOpenChange,
  itens,
  totais,
  offline,
  temMaisDeUmaPessoa,
}: Props) {
  const meus = itens.filter((i) => i.meu);
  const daMesa = itens.filter((i) => !i.meu);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
      >
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5">
          <SheetTitle className="font-display text-2xl leading-tight">
            Seu pedido
          </SheetTitle>

          {offline && (
            <p
              role="status"
              className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground"
            >
              <WifiOffIcon className="size-4 shrink-0" />
              Sem conexão. O que aparece aqui pode estar desatualizado.
            </p>
          )}

          <ListaDeItens itens={meus} />

          {temMaisDeUmaPessoa && daMesa.length > 0 && (
            <>
              <h3 className="mt-6 text-[13px] uppercase tracking-wide text-muted-foreground">
                Resto da mesa
              </h3>
              <ListaDeItens itens={daMesa} mostrarComensal />
            </>
          )}

          {totais && (
            <div className="mt-6 border-t pt-4">
              <Linha rotulo="Consumo" valor={totais.subtotal_cents} />
              {totais.pending_cents > 0 && (
                <Linha
                  rotulo="Aguardando aprovação"
                  valor={totais.pending_cents}
                  esmaecido
                />
              )}
              {totais.service_fee_cents > 0 && (
                <Linha rotulo="Taxa de serviço" valor={totais.service_fee_cents} />
              )}
              <div className="mt-2 flex items-baseline justify-between border-t pt-2">
                <span className="text-[15px] font-medium">Total da mesa</span>
                <span className="tabular text-lg font-semibold">
                  {formatCents(totais.total_cents)}
                </span>
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Valor parcial. O fechamento é feito no caixa.
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ListaDeItens({
  itens,
  mostrarComensal = false,
}: {
  itens: ItemAcompanhado[];
  mostrarComensal?: boolean;
}) {
  if (itens.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">Nada por aqui ainda.</p>;
  }

  return (
    <ul className="mt-3 divide-y">
      {itens.map((item) => {
        const etapa = ETAPAS[item.status] ?? ETAPAS.pending;
        const Icone = etapa.icone;
        const cancelado = etapa.passo < 0;

        return (
          <li key={item.id} className="flex items-start gap-3 py-3">
            <span
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                cancelado
                  ? 'bg-muted text-muted-foreground'
                  : etapa.passo >= 3
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground',
              )}
            >
              <Icone className="size-4" />
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'font-display text-[16px] leading-tight',
                  cancelado && 'text-muted-foreground line-through',
                )}
              >
                {item.qty > 1 && `${item.qty}× `}
                {item.nome}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {etapa.rotulo}
                {mostrarComensal && item.comensal ? ` · ${item.comensal}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Linha({
  rotulo,
  valor,
  esmaecido = false,
}: {
  rotulo: string;
  valor: number;
  esmaecido?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between py-0.5 text-[14px]',
        esmaecido && 'text-muted-foreground',
      )}
    >
      <span>{rotulo}</span>
      <span className="tabular">{formatCents(valor)}</span>
    </div>
  );
}
