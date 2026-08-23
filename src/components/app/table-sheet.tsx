'use client';

import { useEffect, useState, useTransition } from 'react';
import { BellIcon, ReceiptTextIcon } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import {
  buscarMesa,
  entregarItem,
  liberarCurso,
  liberarMesa,
  resolverChamado,
  type MotivoLiberacao,
  type ResultadoAcao,
} from '@/app/app/(equipe)/salao/actions';
import type { DetalheDaMesa } from '@/lib/salao/queries';

import { Elapsed } from './elapsed';

const NOME_CURSO: Record<number, string> = {
  1: 'entradas',
  2: 'principais',
  3: 'sobremesas',
};

const MOTIVOS_LIBERACAO = [
  { valor: 'cliente_foi_embora_sem_pagar', rotulo: 'Foi embora sem pagar' },
  { valor: 'mesa_aberta_por_engano', rotulo: 'Aberta por engano' },
  { valor: 'cortesia_da_casa', rotulo: 'Cortesia da casa' },
  { valor: 'outro', rotulo: 'Outro' },
] as const satisfies readonly { valor: MotivoLiberacao; rotulo: string }[];

const ROTULO_STATUS: Record<string, string> = {
  pending: 'aguardando aprovação',
  held: 'segurado na marcha',
  queued: 'na fila',
  preparing: 'em preparo',
  ready: 'PRONTO',
  delivered: 'entregue',
  out_of_stock: 'acabou',
};

/**
 * Detalhe da mesa (spec §5): comanda completa, quem pediu o quê, tempo aberta,
 * total parcial, entrega de item, marcha e liberação da mesa.
 */
interface Props {
  sessionId: string | null;
  tableLabel: string;
  onFechar: () => void;
  podeForcar: boolean;
}

export function TableSheet({ sessionId, tableLabel, onFechar, podeForcar }: Props) {
  return (
    <Sheet open={Boolean(sessionId)} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-xl p-0 sm:mx-auto sm:max-w-lg"
      >
        {/* `key` na sessão: trocar de mesa REMONTA o corpo e o estado nasce
            limpo. Sem isso, o motivo de liberação escolhido para a mesa 3
            apareceria pré-selecionado ao abrir a mesa 7 — e alguém confirmaria
            sem reler. */}
        {sessionId && (
          <TableSheetBody
            key={sessionId}
            sessionId={sessionId}
            tableLabel={tableLabel}
            podeForcar={podeForcar}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TableSheetBody({
  sessionId,
  tableLabel,
  podeForcar,
}: {
  sessionId: string;
  tableLabel: string;
  podeForcar: boolean;
}) {
  const [mesa, setMesa] = useState<DetalheDaMesa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<
    'itens_na_cozinha' | 'saldo_em_aberto' | null
  >(null);
  const [motivo, setMotivo] = useState<MotivoLiberacao | ''>('');
  const [observacao, setObservacao] = useState('');
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    // Buscar dado de sistema externo na montagem é exatamente o que um efeito
    // deve fazer; o setState acontece dentro do `.then()`, não no corpo.
    void buscarMesa(sessionId).then(setMesa);
  }, [sessionId]);

  function executar(fn: () => Promise<ResultadoAcao>) {
    setErro(null);
    iniciar(async () => {
      const r = await fn();
      if (r.confirmar) {
        setConfirmacao(r.confirmar);
        setErro(r.mensagem ?? null);
        return;
      }
      if (!r.ok) {
        setErro(r.mensagem ?? 'Não foi possível');
        return;
      }
      setConfirmacao(null);
      setMesa(await buscarMesa(sessionId));
    });
  }

  if (!mesa) {
    return (
      <>
        <div className="border-b px-3 py-2.5">
          <SheetTitle className="font-display text-xl leading-none">{tableLabel}</SheetTitle>
        </div>
        <p className="px-3 py-6 text-sm text-muted-foreground">Carregando…</p>
      </>
    );
  }

  const saldo = mesa.totais?.balance_cents ?? 0;
  const precisaForcar = confirmacao === 'saldo_em_aberto' || saldo > 0;
  const motivoPronto =
    Boolean(motivo) && (motivo !== 'outro' || observacao.trim().length > 0);

  return (
    <>
      <div className="border-b px-3 py-2.5">
        <SheetTitle className="font-display text-xl leading-none">{tableLabel}</SheetTitle>
        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          aberta há
          <Elapsed segundosIniciais={mesa.abertaHaSegundos} alertaSegundos={5400} />
          {mesa.convidados.length > 0 &&
            `· ${mesa.convidados.length} ${mesa.convidados.length === 1 ? 'pessoa' : 'pessoas'}`}
        </p>
      </div>

      {mesa.chamados.length > 0 && (
        <div className="border-b bg-alert-critical/15 px-3 py-2">
          {mesa.chamados.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-1">
              <span className="flex items-center gap-2 text-[14px] font-semibold text-alert-critical">
                {c.tipo === 'request_bill' ? (
                  <ReceiptTextIcon className="size-4" />
                ) : (
                  <BellIcon className="size-4" />
                )}
                {c.tipo === 'request_bill' ? 'Pediu a conta' : 'Chamou o garçom'}
                <Elapsed segundosIniciais={c.desdeSegundos} alertaSegundos={120} />
              </span>
              <button
                type="button"
                disabled={pendente}
                onClick={() => executar(() => resolverChamado(c.id))}
                className="h-10 rounded-md bg-foreground px-3 text-[13px] font-semibold text-background"
              >
                Atendi
              </button>
            </div>
          ))}
        </div>
      )}

      {mesa.cursosRetidos.length > 0 && (
        <div className="border-b px-3 py-2">
          <p className="text-[12px] font-semibold uppercase text-muted-foreground">
            Marcha
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {mesa.cursosRetidos.map((c) => (
              <button
                key={c}
                type="button"
                disabled={pendente}
                onClick={() => executar(() => liberarCurso(sessionId, c))}
                className="h-12 rounded-md bg-alert-warning px-4 text-[14px] font-bold text-background"
              >
                Liberar {NOME_CURSO[c] ?? `curso ${c}`}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Segurado não vai para a cozinha até você liberar.
          </p>
        </div>
      )}

      <ul className="divide-y">
        {mesa.itens.map((item) => (
          <li key={item.id} className="flex items-start gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight">
                {item.qty}× {item.nome}
              </p>
              {item.modificadores.length > 0 && (
                <p className="text-[12px] font-medium uppercase text-alert-warning">
                  {item.modificadores.join(' · ')}
                </p>
              )}
              {item.notes && (
                <p className="text-[12px] italic text-muted-foreground">“{item.notes}”</p>
              )}
              <p
                className={cn(
                  'text-[11px]',
                  item.status === 'ready'
                    ? 'font-bold text-alert-warning'
                    : 'text-muted-foreground',
                )}
              >
                {ROTULO_STATUS[item.status] ?? item.status}
                {item.comensal && ` · ${item.comensal}`}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="tabular text-[13px]">{formatCents(item.totalCents)}</span>
              {item.status === 'ready' && (
                <button
                  type="button"
                  disabled={pendente}
                  onClick={() => executar(() => entregarItem(item.id))}
                  className="h-10 rounded-md bg-alert-calm px-3 text-[12px] font-bold text-background"
                >
                  Entreguei
                </button>
              )}
            </div>
          </li>
        ))}
        {mesa.itens.length === 0 && (
          <li className="px-3 py-4 text-sm text-muted-foreground">Nada pedido ainda.</li>
        )}
      </ul>

      {mesa.totais && (
        <div className="border-t px-3 py-2 text-[14px]">
          <Linha rotulo="Consumo" valor={mesa.totais.subtotal_cents} />
          {mesa.totais.pending_cents > 0 && (
            <Linha
              rotulo="Aguardando aprovação"
              valor={mesa.totais.pending_cents}
              esmaecido
            />
          )}
          <Linha rotulo="Taxa de serviço" valor={mesa.totais.service_fee_cents} />
          {mesa.totais.paid_cents > 0 && (
            <Linha rotulo="Pago" valor={mesa.totais.paid_cents} />
          )}
          <div className="mt-1 flex items-baseline justify-between border-t pt-1">
            <span className="font-semibold">Saldo</span>
            <span
              className={cn(
                'tabular text-lg font-bold',
                saldo > 0 && 'text-alert-critical',
              )}
            >
              {formatCents(saldo)}
            </span>
          </div>
        </div>
      )}

      {/* --- liberar mesa (spec §5) ------------------------------------- */}
      <div className="border-t p-3">
        {erro && (
          <p role="alert" className="mb-2 text-[13px] text-destructive">
            {erro}
          </p>
        )}

        {confirmacao === 'itens_na_cozinha' && (
          <p className="mb-2 rounded-md bg-alert-warning/15 px-2.5 py-2 text-[13px] text-alert-warning">
            Ainda há item na cozinha. Liberar cancela o que estiver em produção.
          </p>
        )}

        {precisaForcar &&
          (podeForcar ? (
            <div className="mb-2">
              <p className="text-[12px] font-semibold uppercase text-muted-foreground">
                Motivo da liberação forçada
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {MOTIVOS_LIBERACAO.map((m) => (
                  <button
                    key={m.valor}
                    type="button"
                    onClick={() => setMotivo(m.valor)}
                    className={cn(
                      'rounded px-2.5 py-2 text-[12px]',
                      motivo === m.valor
                        ? 'bg-alert-critical font-semibold text-background'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {m.rotulo}
                  </button>
                ))}
              </div>
              {motivo === 'outro' && (
                <input
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  maxLength={200}
                  placeholder="O que aconteceu?"
                  className="mt-2 h-11 w-full rounded-md border border-input bg-transparent px-3 text-[15px] outline-none"
                />
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Vai para a auditoria e aparece no painel do dono.
              </p>
            </div>
          ) : (
            <p className="mb-2 rounded-md bg-muted px-2.5 py-2 text-[13px] text-muted-foreground">
              Saldo em aberto. Só gerente ou dono libera esta mesa.
            </p>
          ))}

        <button
          type="button"
          disabled={pendente || (precisaForcar && (!podeForcar || !motivoPronto))}
          onClick={() =>
            executar(() =>
              liberarMesa(sessionId, {
                forcada: precisaForcar || confirmacao === 'itens_na_cozinha',
                motivo: precisaForcar && motivo ? motivo : undefined,
                observacao: motivo === 'outro' ? observacao.trim() : undefined,
              }),
            )
          }
          className={cn(
            'h-12 w-full rounded-md text-[15px] font-bold disabled:opacity-40',
            precisaForcar
              ? 'bg-alert-critical text-background'
              : 'bg-foreground text-background',
          )}
        >
          {pendente
            ? 'Liberando…'
            : precisaForcar
              ? 'Forçar liberação'
              : confirmacao === 'itens_na_cozinha'
                ? 'Liberar mesmo assim'
                : 'Liberar mesa'}
        </button>
      </div>
    </>
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
        'flex items-baseline justify-between py-0.5',
        esmaecido && 'text-muted-foreground',
      )}
    >
      <span>{rotulo}</span>
      <span className="tabular">{formatCents(valor)}</span>
    </div>
  );
}
