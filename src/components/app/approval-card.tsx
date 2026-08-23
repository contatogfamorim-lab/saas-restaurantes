'use client';

import { useState, useTransition } from 'react';
import { CheckIcon, XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import { aprovarPedido } from '@/app/app/(equipe)/salao/actions';
import type { PedidoParaAprovar } from '@/lib/salao/queries';

import { Elapsed } from './elapsed';

/**
 * Card da fila de aprovação (spec §5) — a coisa mais importante desta tela.
 *
 * Dois modos:
 *  - padrão: um toque em "Aprovar tudo", que é o que acontece em 90% dos casos;
 *  - ajuste: checkbox por item e recusa com motivo, para o resto.
 *
 * O caminho comum tem que ser UM toque. Se aprovar exigir três, o garçom deixa
 * a fila acumular e o sistema vira estorvo em vez de ajuda.
 */

const MOTIVOS = [
  { valor: 'acabou', rotulo: 'Acabou' },
  { valor: 'cliente_desistiu', rotulo: 'Cliente desistiu' },
  { valor: 'erro_no_pedido', rotulo: 'Erro no pedido' },
] as const;

type Motivo = (typeof MOTIVOS)[number]['valor'];

interface Props {
  pedido: PedidoParaAprovar;
  podeMarcarEsgotado: boolean;
}

export function ApprovalCard({ pedido, podeMarcarEsgotado }: Props) {
  const [ajustando, setAjustando] = useState(false);
  const [recusas, setRecusas] = useState<Record<string, Motivo>>({});
  const [esgotar, setEsgotar] = useState<Record<string, boolean>>({});
  const [reterCursos, setReterCursos] = useState<number[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const cursos = [...new Set(pedido.itens.map((i) => i.course))].sort();
  const temMaisDeUmCurso = cursos.length > 1;

  function enviar(aprovarTodos: boolean) {
    setErro(null);
    iniciar(async () => {
      const recusados = Object.keys(recusas);
      const aprovados = aprovarTodos
        ? pedido.itens.map((i) => i.id)
        : pedido.itens.filter((i) => !recusas[i.id]).map((i) => i.id);

      const r = await aprovarPedido({
        orderId: pedido.orderId,
        aprovados,
        recusas: aprovarTodos
          ? []
          : recusados.map((id) => ({
              itemId: id,
              motivo: recusas[id],
              marcarEsgotado: Boolean(esgotar[id]),
            })),
        reterCursos: aprovarTodos ? [] : reterCursos,
      });

      if (!r.ok) setErro(r.mensagem ?? 'Não foi possível');
    });
  }

  const total = pedido.itens.reduce((s, i) => s + i.precoCents, 0);

  return (
    <article className="rounded-lg border-2 border-alert-critical bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          {/* Número da mesa em corpo grande: é o que o garçom procura primeiro */}
          <p className="font-display text-xl leading-none">{pedido.tableLabel}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {pedido.guestName ?? 'Sem nome'} · {pedido.tableArea}
          </p>
        </div>
        <Elapsed segundosIniciais={pedido.esperandoSegundos} alertaSegundos={60} />
      </header>

      <ul className="divide-y">
        {pedido.itens.map((item) => {
          const recusado = recusas[item.id];
          return (
            <li key={item.id} className={cn('px-3 py-2', recusado && 'bg-muted/60')}>
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    'text-[15px] font-semibold leading-tight',
                    recusado && 'text-muted-foreground line-through',
                  )}
                >
                  {item.qty}× {item.nome}
                </p>
                <span className="tabular shrink-0 text-[13px] text-muted-foreground">
                  {formatCents(item.precoCents)}
                </span>
              </div>

              {item.modificadores.length > 0 && (
                <p className="mt-0.5 text-[12px] font-medium uppercase text-alert-warning">
                  {item.modificadores.join(' · ')}
                </p>
              )}
              {item.notes && (
                <p className="mt-0.5 text-[12px] italic text-muted-foreground">
                  “{item.notes}”
                </p>
              )}
              {item.comensal && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  para {item.comensal}
                </p>
              )}

              {ajustando && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setRecusas((r) => {
                          const copia = { ...r };
                          delete copia[item.id];
                          return copia;
                        })
                      }
                      className={cn(
                        'rounded px-2 py-1.5 text-[12px] font-semibold',
                        !recusado
                          ? 'bg-alert-calm text-background'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      Aprovar
                    </button>
                    {MOTIVOS.map((m) => (
                      <button
                        key={m.valor}
                        type="button"
                        onClick={() => setRecusas((r) => ({ ...r, [item.id]: m.valor }))}
                        className={cn(
                          'rounded px-2 py-1.5 text-[12px]',
                          recusado === m.valor
                            ? 'bg-alert-critical font-semibold text-background'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {m.rotulo}
                      </button>
                    ))}
                  </div>

                  {/* "Marcar como esgotado no cardápio?" (spec §5): some de
                      todos os celulares da casa na hora */}
                  {recusado === 'acabou' && podeMarcarEsgotado && (
                    <label className="mt-2 flex items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        checked={Boolean(esgotar[item.id])}
                        onChange={(e) =>
                          setEsgotar((s) => ({ ...s, [item.id]: e.target.checked }))
                        }
                        className="size-4 accent-[var(--alert-critical,currentColor)]"
                      />
                      Marcar “{item.nome}” como esgotado no cardápio
                    </label>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {ajustando && temMaisDeUmCurso && (
        <div className="border-t px-3 py-2">
          <p className="text-[12px] font-semibold uppercase text-muted-foreground">
            Segurar para a marcha
          </p>
          <div className="mt-1 flex gap-1">
            {cursos.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() =>
                  setReterCursos((r) =>
                    r.includes(c) ? r.filter((x) => x !== c) : [...r, c],
                  )
                }
                className={cn(
                  'rounded px-2.5 py-1.5 text-[12px] font-semibold',
                  reterCursos.includes(c)
                    ? 'bg-alert-warning text-background'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {c === 1 ? 'Entrada' : c === 2 ? 'Principal' : 'Sobremesa'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            O que estiver segurado não vai para a cozinha até você liberar.
          </p>
        </div>
      )}

      {erro && (
        <p role="alert" className="border-t px-3 py-2 text-[13px] text-destructive">
          {erro}
        </p>
      )}

      <footer className="flex gap-2 border-t p-2">
        {!ajustando ? (
          <>
            <button
              type="button"
              onClick={() => setAjustando(true)}
              className="h-12 rounded-md bg-muted px-4 text-[14px] font-semibold"
            >
              Ajustar
            </button>
            <button
              type="button"
              disabled={pendente}
              onClick={() => enviar(true)}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-alert-calm text-[15px] font-bold text-background disabled:opacity-50"
            >
              <CheckIcon className="size-5" />
              Aprovar tudo · {formatCents(total)}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setAjustando(false);
                setRecusas({});
                setEsgotar({});
                setReterCursos([]);
              }}
              className="flex h-12 items-center justify-center rounded-md bg-muted px-4"
              aria-label="Cancelar ajuste"
            >
              <XIcon className="size-5" />
            </button>
            <button
              type="button"
              disabled={pendente}
              onClick={() => enviar(false)}
              className="h-12 flex-1 rounded-md bg-foreground text-[15px] font-bold text-background disabled:opacity-50"
            >
              {pendente ? 'Enviando…' : 'Confirmar'}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
