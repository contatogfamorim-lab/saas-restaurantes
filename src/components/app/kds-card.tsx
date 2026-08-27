'use client';

import { useState, useTransition } from 'react';

import { cn } from '@/lib/utils';
import { acabou, iniciarItem, itemPronto } from '@/app/app/(equipe)/cozinha/actions';
import type { ItemNaProducao } from '@/lib/cozinha/queries';

import { KdsTimer } from './kds-timer';

/**
 * Card de um item na produção (spec §6).
 *
 * Hierarquia visual, do mais para o menos importante:
 *   1. NÚMERO DA MESA, em corpo enorme — é por ele que o prato é entregue
 *   2. MODIFICADORES, em faixa de alto contraste — "SEM CEBOLA" ignorado é
 *      prato devolvido, e é aqui que erro custa comida jogada fora
 *   3. o prato e a quantidade
 *   4. o nome do cliente
 *
 * Tudo dimensionado para leitura a 2 metros, com botões de 64px+: a mão está
 * engordurada, com luva, e a tela tem vapor.
 */
interface Props {
  item: ItemNaProducao;
  podeRemoverDoCardapio: boolean;
}

export function KdsCard({ item, podeRemoverDoCardapio }: Props) {
  const [confirmandoAcabou, setConfirmandoAcabou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function executar(fn: () => Promise<{ ok: boolean; mensagem?: string }>) {
    setErro(null);
    iniciar(async () => {
      const r = await fn();
      if (!r.ok) setErro(r.mensagem ?? 'Não foi possível');
      else setConfirmandoAcabou(false);
    });
  }

  return (
    <article
      className={cn(
        'rounded-lg border-2 bg-card',
        item.status === 'ready' ? 'border-alert-calm' : 'border-border',
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b-2 px-3 py-2">
        {/* Número da mesa em corpo enorme: é o que a cozinha grita */}
        <span className="font-display text-4xl leading-none">
          {item.mesa.replace(/^Mesa\s*/i, '')}
        </span>
        {/* Conta desde queued_at em TODOS os estados (spec §6): é o tempo que
            o cliente sente, não o tempo de chapa. */}
        <KdsTimer
          segundosIniciais={item.naFilaSegundos}
          prepMinutes={item.prepMinutes}
          className="text-2xl"
        />
      </header>

      <div className="px-3 py-2">
        <p className="text-2xl font-bold leading-tight">
          {item.qty > 1 && (
            <span className="mr-1 rounded bg-foreground px-1.5 text-background">
              {item.qty}×
            </span>
          )}
          {item.produto}
        </p>

        {/* Faixa de alto contraste: é aqui que erro vira prato devolvido */}
        {item.modificadores.length > 0 && (
          <p className="mt-1.5 rounded bg-alert-warning px-2 py-1 text-lg font-black uppercase leading-tight text-background">
            {item.modificadores.join(' · ')}
          </p>
        )}

        {item.notes && (
          <p className="mt-1.5 rounded border-2 border-alert-critical px-2 py-1 text-base font-semibold leading-tight text-alert-critical">
            {item.notes}
          </p>
        )}

        {item.cliente && (
          <p className="mt-1.5 text-sm text-muted-foreground">{item.cliente}</p>
        )}
      </div>

      {erro && (
        <p role="alert" className="border-t px-3 py-1.5 text-sm text-destructive">
          {erro}
        </p>
      )}

      {confirmandoAcabou ? (
        <div className="border-t-2 p-2">
          <p className="mb-2 text-center text-sm font-semibold">
            Zerou o {item.produto}?
          </p>
          <div className="grid gap-2">
            {podeRemoverDoCardapio && (
              <button
                type="button"
                disabled={pendente}
                onClick={() => executar(() => acabou(item.id, true))}
                className="h-16 rounded-md bg-alert-critical text-base font-bold text-background disabled:opacity-50"
              >
                Sim — tirar do cardápio
              </button>
            )}
            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => acabou(item.id, false))}
              className="h-16 rounded-md bg-muted text-base font-bold disabled:opacity-50"
            >
              Só este item
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoAcabou(false)}
              className="h-12 rounded-md text-sm text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <footer className="flex gap-2 border-t-2 p-2">
          {item.status === 'queued' && (
            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => iniciarItem(item.id))}
              // 64px é o mínimo da §6: mão engordurada, luva, tela com vapor
              className="h-16 flex-1 rounded-md bg-foreground text-lg font-bold text-background disabled:opacity-50"
            >
              Iniciar
            </button>
          )}

          {item.status === 'preparing' && (
            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => itemPronto(item.id))}
              className="h-16 flex-1 rounded-md bg-alert-calm text-lg font-bold text-background disabled:opacity-50"
            >
              Pronto
            </button>
          )}

          {item.status === 'ready' && (
            <p className="flex h-16 flex-1 items-center justify-center rounded-md bg-alert-calm/15 text-base font-bold text-alert-calm">
              Aguardando o garçom
            </p>
          )}

          {item.status !== 'ready' && (
            <button
              type="button"
              disabled={pendente}
              onClick={() => setConfirmandoAcabou(true)}
              className="h-16 rounded-md border-2 border-alert-critical px-4 text-base font-bold text-alert-critical disabled:opacity-50"
            >
              Zerou
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
