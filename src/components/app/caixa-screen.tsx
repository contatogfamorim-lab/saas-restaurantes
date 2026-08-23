'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReceiptTextIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import type { ComandaNaLista } from '@/lib/caixa/queries';

import { BillSheet } from './bill-sheet';
import { Elapsed } from './elapsed';

/**
 * Tela do caixa (spec §7).
 *
 * A ordem da lista é a fila real: quem pediu a conta primeiro, depois a mesa
 * mais antiga. Ordenar por número da mesa faria a pessoa que já pediu a conta
 * esperar atrás de quem acabou de sentar.
 */
export function CaixaScreen({
  comandas,
  podeForcar,
  tetoDesconto,
}: {
  comandas: ComandaNaLista[];
  podeForcar: boolean;
  tetoDesconto: number;
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState<ComandaNaLista | null>(null);

  // Recarga periódica — PROVISÓRIA, trocada por Realtime na Etapa 7.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [router]);

  const aReceber = comandas.reduce((s, c) => s + c.saldoCents, 0);

  return (
    <div className="p-3 pb-8">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
          {comandas.length} {comandas.length === 1 ? 'comanda aberta' : 'comandas abertas'}
        </h1>
        <span className="tabular text-[13px] text-muted-foreground">
          a receber {formatCents(aReceber)}
        </span>
      </header>

      {comandas.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma mesa aberta.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {comandas.map((c) => (
            <button
              key={c.sessionId}
              type="button"
              onClick={() => setAberta(c)}
              className={cn(
                'rounded-lg border-2 p-3 text-left',
                c.pediuAConta
                  ? 'border-alert-critical bg-alert-critical/10'
                  : 'border-border bg-card',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-2xl leading-none">{c.mesa}</span>
                {c.pediuAConta && (
                  <span className="flex items-center gap-1 rounded bg-alert-critical px-1.5 py-0.5 text-[11px] font-bold text-background">
                    <ReceiptTextIcon className="size-3" />
                    PEDIU A CONTA
                  </span>
                )}
              </div>

              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {c.pessoas} {c.pessoas === 1 ? 'pessoa' : 'pessoas'}
                {c.garcom && ` · ${c.garcom}`}
                {' · '}
                <Elapsed segundosIniciais={c.abertaHaSegundos} alertaSegundos={5400} />
              </p>

              <p className="tabular mt-2 text-2xl font-bold">
                {formatCents(c.saldoCents)}
              </p>

              {c.pendenteCents > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  + {formatCents(c.pendenteCents)} aguardando o garçom
                </p>
              )}

              {c.emProducao > 0 && (
                <p className="text-[11px] text-alert-warning">
                  {c.emProducao} na cozinha
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      <BillSheet
        sessionId={aberta?.sessionId ?? null}
        mesa={aberta?.mesa ?? ''}
        onFechar={() => {
          setAberta(null);
          router.refresh();
        }}
        podeForcar={podeForcar}
        tetoDesconto={tetoDesconto}
      />
    </div>
  );
}
