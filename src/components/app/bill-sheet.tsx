'use client';

import { useEffect, useState, useTransition } from 'react';
import { PrinterIcon, UsersIcon } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { formatCents, formatCentsBare, parseCents } from '@/lib/money';
import {
  aplicarDesconto,
  buscarConta,
  liberarMesaDoCaixa,
  registrarPagamento,
  removerTaxa,
} from '@/app/app/(equipe)/caixa/actions';
import type { ContaDetalhada, ItemDaConta } from '@/lib/caixa/queries';
import {
  METODOS_PAGAMENTO,
  type MetodoPagamento,
  type ResultadoCaixa,
} from '@/lib/caixa/tipos';

import { Elapsed } from './elapsed';

const MOTIVOS_LIBERACAO = [
  { valor: 'cliente_foi_embora_sem_pagar', rotulo: 'Foi embora sem pagar' },
  { valor: 'mesa_aberta_por_engano', rotulo: 'Aberta por engano' },
  { valor: 'cortesia_da_casa', rotulo: 'Cortesia da casa' },
  { valor: 'outro', rotulo: 'Outro' },
] as const;

/**
 * Detalhe da comanda no caixa (spec §7).
 *
 * `key` na sessão remonta tudo ao trocar de comanda: valor digitado, método
 * escolhido e motivo de desconto não podem sobreviver de uma mesa para outra.
 * Registrar na mesa errada o valor que estava na tela é o erro mais caro que
 * esta tela pode cometer.
 */
export function BillSheet({
  sessionId,
  mesa,
  onFechar,
  podeForcar,
  tetoDesconto,
}: {
  sessionId: string | null;
  mesa: string;
  onFechar: () => void;
  podeForcar: boolean;
  tetoDesconto: number;
}) {
  return (
    <Sheet open={Boolean(sessionId)} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent
        side="bottom"
        className="max-h-[94dvh] gap-0 overflow-y-auto rounded-t-xl p-0 sm:mx-auto sm:max-w-2xl"
      >
        {sessionId && (
          <Corpo
            key={sessionId}
            sessionId={sessionId}
            mesa={mesa}
            podeForcar={podeForcar}
            tetoDesconto={tetoDesconto}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Corpo({
  sessionId,
  mesa,
  podeForcar,
  tetoDesconto,
}: {
  sessionId: string;
  mesa: string;
  podeForcar: boolean;
  tetoDesconto: number;
}) {
  const [conta, setConta] = useState<ContaDetalhada | null>(null);
  const [agrupamento, setAgrupamento] = useState<'pessoa' | 'rodada'>('pessoa');
  const [metodo, setMetodo] = useState<MetodoPagamento>('pix');
  const [valorTexto, setValorTexto] = useState('');
  const [entregueTexto, setEntregueTexto] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const [abrindoDesconto, setAbrindoDesconto] = useState(false);
  const [descontoPercent, setDescontoPercent] = useState('');
  const [descontoMotivo, setDescontoMotivo] = useState('');

  const [confirmacao, setConfirmacao] = useState<
    'itens_na_cozinha' | 'saldo_em_aberto' | null
  >(null);
  const [motivoLiberacao, setMotivoLiberacao] = useState('');

  useEffect(() => {
    void buscarConta(sessionId).then(setConta);
  }, [sessionId]);

  function executar(fn: () => Promise<ResultadoCaixa>, aoConcluir?: () => void) {
    setErro(null);
    setAviso(null);
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
      if (r.trocoCents && r.trocoCents > 0) {
        setAviso(`Troco: ${formatCents(r.trocoCents)}`);
      } else if (r.mensagem) {
        setAviso(r.mensagem);
      }
      aoConcluir?.();
      setConta(await buscarConta(sessionId));
    });
  }

  if (!conta) {
    return (
      <>
        <div className="border-b px-4 py-3">
          <SheetTitle className="font-display text-2xl leading-none">{mesa}</SheetTitle>
        </div>
        <p className="px-4 py-8 text-sm text-muted-foreground">Carregando…</p>
      </>
    );
  }

  const { totais } = conta;
  const valorCents = parseCents(valorTexto);
  const entregueCents = parseCents(entregueTexto);
  const quitada = totais.saldoCents <= 0;
  const precisaForcar = confirmacao === 'saldo_em_aberto' || totais.saldoCents > 0;

  const trocoPrevisto =
    metodo === 'dinheiro' && entregueCents !== null && valorCents !== null
      ? entregueCents - valorCents
      : null;

  const podePagar =
    valorCents !== null &&
    valorCents > 0 &&
    valorCents <= totais.saldoCents &&
    (metodo !== 'dinheiro' ||
      entregueTexto.trim() === '' ||
      (entregueCents !== null && entregueCents >= valorCents));

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <SheetTitle className="font-display text-2xl leading-none">{mesa}</SheetTitle>
          <p className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
            {conta.garcom && <span>{conta.garcom} ·</span>}
            <span className="flex items-center gap-1">
              <UsersIcon className="size-3" />
              {conta.pessoas.length}
            </span>
            · aberta há <Elapsed segundosIniciais={conta.abertaHaSegundos} alertaSegundos={5400} />
          </p>
        </div>

        <a
          href={`/app/caixa/${sessionId}/conta`}
          target="_blank"
          rel="noreferrer"
          className="flex h-11 items-center gap-1.5 rounded-md bg-muted px-3 text-[13px] font-semibold"
        >
          <PrinterIcon className="size-4" />
          Conta
        </a>
      </div>

      {/* --- agrupamento (spec §7): por pessoa OU por rodada ------------------ */}
      <div className="flex gap-1 border-b px-4 py-2">
        {(['pessoa', 'rodada'] as const).map((modo) => (
          <button
            key={modo}
            type="button"
            onClick={() => setAgrupamento(modo)}
            className={cn(
              'rounded-md px-3 py-2 text-[13px] font-semibold capitalize',
              agrupamento === modo
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground',
            )}
          >
            Por {modo}
          </button>
        ))}
      </div>

      <div className="px-4 py-2">
        {agrupamento === 'pessoa'
          ? conta.pessoas.map((p) => (
              <Grupo
                key={p.id}
                titulo={p.nome}
                total={p.totalCents}
                itens={conta.itens.filter((i) => i.guestId === p.id)}
                onUsarValor={() => setValorTexto(formatCentsBare(p.totalCents))}
              />
            ))
          : conta.rodadas.map((r) => (
              <Grupo
                key={r.orderId}
                titulo={`Rodada ${r.numero}`}
                total={r.itens.reduce((s, i) => s + i.totalCents, 0)}
                itens={r.itens}
              />
            ))}

        {conta.itens.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">Nada lançado ainda.</p>
        )}
      </div>

      {/* --- totais ---------------------------------------------------------- */}
      <div className="border-t px-4 py-3 text-[14px]">
        <Linha rotulo="Consumo" valor={totais.subtotalCents} />

        {totais.pendenteCents > 0 && (
          <Linha
            rotulo="Aguardando aprovação do garçom"
            valor={totais.pendenteCents}
            esmaecido
          />
        )}

        <div className="flex items-baseline justify-between py-0.5">
          <span className={cn(totais.taxaRemovida && 'text-muted-foreground line-through')}>
            Taxa de serviço
          </span>
          <span className="flex items-center gap-2">
            <span className="tabular">{formatCents(totais.taxaCents)}</span>
            {!totais.taxaRemovida && (
              <button
                type="button"
                disabled={pendente}
                onClick={() => {
                  const motivo = window.prompt('Motivo para remover a taxa:');
                  if (motivo && motivo.trim().length >= 3) {
                    executar(() => removerTaxa(sessionId, motivo));
                  }
                }}
                className="rounded px-2 py-1 text-[12px] text-muted-foreground underline underline-offset-2"
              >
                remover
              </button>
            )}
          </span>
        </div>

        {totais.descontoCents > 0 && (
          <Linha rotulo="Desconto" valor={-totais.descontoCents} />
        )}

        <div className="mt-1 flex items-baseline justify-between border-t pt-1">
          <span className="font-semibold">Total</span>
          <span className="tabular text-lg font-bold">{formatCents(totais.totalCents)}</span>
        </div>

        {totais.pagoCents > 0 && <Linha rotulo="Pago" valor={totais.pagoCents} />}

        <div className="mt-1 flex items-baseline justify-between border-t pt-1">
          <span className="font-semibold">Saldo</span>
          <span
            className={cn(
              'tabular text-2xl font-black',
              quitada ? 'text-alert-calm' : 'text-alert-critical',
            )}
          >
            {formatCents(totais.saldoCents)}
          </span>
        </div>
      </div>

      {/* --- ajustes já feitos, com autor (spec §10.8) ------------------------ */}
      {conta.ajustes.length > 0 && (
        <ul className="border-t px-4 py-2 text-[12px] text-muted-foreground">
          {conta.ajustes.map((a, i) => (
            <li key={i}>
              {a.tipo === 'discount'
                ? `Desconto de ${formatCents(a.valorCents)}`
                : 'Taxa removida'}
              {' — '}
              {a.motivo}
              {a.porQuem && ` (${a.porQuem})`}
            </li>
          ))}
        </ul>
      )}

      {/* --- pagamentos já registrados --------------------------------------- */}
      {conta.pagamentos.length > 0 && (
        <ul className="border-t px-4 py-2 text-[13px]">
          {conta.pagamentos.map((p) => (
            <li key={p.id} className="flex justify-between py-0.5">
              <span className="capitalize text-muted-foreground">
                {p.metodo}
                {p.trocoCents > 0 && ` · troco ${formatCents(p.trocoCents)}`}
                {p.porQuem && ` · ${p.porQuem}`}
              </span>
              <span className="tabular">{formatCents(p.valorCents)}</span>
            </li>
          ))}
        </ul>
      )}

      {(erro || aviso) && (
        <p
          role={erro ? 'alert' : 'status'}
          className={cn(
            'border-t px-4 py-2 text-[13px] font-semibold',
            erro ? 'text-destructive' : 'text-alert-calm',
          )}
        >
          {erro ?? aviso}
        </p>
      )}

      {/* --- registrar pagamento --------------------------------------------- */}
      {!quitada && (
        <div className="border-t px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {METODOS_PAGAMENTO.map((m) => (
              <button
                key={m.valor}
                type="button"
                onClick={() => setMetodo(m.valor)}
                className={cn(
                  'h-11 rounded-md px-3 text-[13px] font-semibold',
                  metodo === m.valor
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {m.rotulo}
              </button>
            ))}
          </div>

          {/* Divisão (spec §7): atalhos que só PREENCHEM o valor — quem decide
              quanto entra no caixa continua sendo a pessoa. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Atalho onClick={() => setValorTexto(formatCentsBare(totais.saldoCents))}>
              Tudo
            </Atalho>
            {conta.pessoas.length > 1 && (
              <Atalho
                onClick={() =>
                  setValorTexto(
                    formatCentsBare(Math.ceil(totais.saldoCents / conta.pessoas.length)),
                  )
                }
              >
                ÷ {conta.pessoas.length}
              </Atalho>
            )}
          </div>

          <div className="mt-2 flex gap-2">
            <label className="flex-1">
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                Valor
              </span>
              <input
                value={valorTexto}
                onChange={(e) => setValorTexto(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="tabular mt-0.5 h-12 w-full rounded-md border border-input bg-transparent px-3 text-xl font-bold outline-none"
              />
            </label>

            {metodo === 'dinheiro' && (
              <label className="flex-1">
                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                  Entregue
                </span>
                <input
                  value={entregueTexto}
                  onChange={(e) => setEntregueTexto(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="tabular mt-0.5 h-12 w-full rounded-md border border-input bg-transparent px-3 text-xl font-bold outline-none"
                />
              </label>
            )}
          </div>

          {trocoPrevisto !== null && trocoPrevisto > 0 && (
            <p className="mt-1.5 text-[15px] font-bold text-alert-warning">
              Troco: {formatCents(trocoPrevisto)}
            </p>
          )}

          {valorCents !== null && valorCents > totais.saldoCents && (
            <p className="mt-1.5 text-[13px] text-destructive">
              Valor maior que o saldo de {formatCents(totais.saldoCents)}
            </p>
          )}

          <button
            type="button"
            disabled={!podePagar || pendente}
            onClick={() =>
              executar(
                () =>
                  registrarPagamento({
                    sessionId,
                    metodo,
                    valorCents: valorCents!,
                    entregueCents:
                      metodo === 'dinheiro' && entregueCents ? entregueCents : undefined,
                    // Chave por comanda + valor + método + instante: repetir o
                    // toque com a rede lenta não cobra duas vezes (spec §13.7).
                    idempotencyKey: `pg-${sessionId.slice(0, 8)}-${valorCents}-${metodo}-${Math.floor(Date.now() / 1000)}`,
                  }),
                () => {
                  setValorTexto('');
                  setEntregueTexto('');
                },
              )
            }
            className="mt-3 h-14 w-full rounded-md bg-alert-calm text-lg font-bold text-background disabled:opacity-40"
          >
            {pendente ? 'Registrando…' : 'Registrar pagamento'}
          </button>

          {/* --- desconto ---------------------------------------------------- */}
          {!abrindoDesconto ? (
            <button
              type="button"
              onClick={() => setAbrindoDesconto(true)}
              className="mt-2 h-11 w-full rounded-md bg-muted text-[13px] font-semibold"
            >
              Dar desconto
            </button>
          ) : (
            <div className="mt-2 rounded-md bg-muted p-2">
              <p className="text-[12px] text-muted-foreground">
                Seu limite: {tetoDesconto}%
              </p>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={descontoPercent}
                  onChange={(e) => setDescontoPercent(e.target.value)}
                  inputMode="decimal"
                  placeholder="%"
                  className="tabular h-11 w-20 rounded-md border border-input bg-transparent px-2 text-lg font-bold outline-none"
                />
                <input
                  value={descontoMotivo}
                  onChange={(e) => setDescontoMotivo(e.target.value)}
                  placeholder="Motivo (obrigatório)"
                  maxLength={300}
                  className="h-11 flex-1 rounded-md border border-input bg-transparent px-2 text-[14px] outline-none"
                />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setAbrindoDesconto(false)}
                  className="h-11 rounded-md px-3 text-[13px] text-muted-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={
                    pendente ||
                    descontoMotivo.trim().length < 3 ||
                    !Number(descontoPercent.replace(',', '.'))
                  }
                  onClick={() =>
                    executar(
                      () =>
                        aplicarDesconto({
                          sessionId,
                          percent: Number(descontoPercent.replace(',', '.')),
                          motivo: descontoMotivo.trim(),
                        }),
                      () => {
                        setAbrindoDesconto(false);
                        setDescontoPercent('');
                        setDescontoMotivo('');
                      },
                    )
                  }
                  className="h-11 flex-1 rounded-md bg-foreground text-[13px] font-bold text-background disabled:opacity-40"
                >
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- liberar mesa (spec §5, mesma ação da tela do garçom) ------------- */}
      <div className="border-t p-4">
        {confirmacao === 'itens_na_cozinha' && (
          <p className="mb-2 rounded-md bg-alert-warning/15 px-3 py-2 text-[13px] text-alert-warning">
            Ainda há {conta.emProducao} item(ns) na cozinha. Liberar cancela o que
            estiver em produção.
          </p>
        )}

        {precisaForcar && (
          <div className="mb-2">
            {!podeForcar ? (
              <p className="rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                Saldo em aberto. Só gerente ou administrador pode liberar esta mesa.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {MOTIVOS_LIBERACAO.map((m) => (
                  <button
                    key={m.valor}
                    type="button"
                    onClick={() => setMotivoLiberacao(m.valor)}
                    className={cn(
                      'rounded px-2.5 py-2 text-[12px]',
                      motivoLiberacao === m.valor
                        ? 'bg-alert-critical font-semibold text-background'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {m.rotulo}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={pendente || (precisaForcar && (!podeForcar || !motivoLiberacao))}
          onClick={() =>
            executar(() =>
              liberarMesaDoCaixa(sessionId, {
                forcada: precisaForcar || confirmacao === 'itens_na_cozinha',
                motivo: precisaForcar ? motivoLiberacao : undefined,
              }),
            )
          }
          className={cn(
            'h-14 w-full rounded-md text-lg font-bold disabled:opacity-40',
            quitada
              ? 'bg-foreground text-background'
              : 'bg-alert-critical text-background',
          )}
        >
          {quitada ? 'Fechar e liberar mesa' : 'Forçar liberação'}
        </button>
      </div>
    </>
  );
}

function Grupo({
  titulo,
  total,
  itens,
  onUsarValor,
}: {
  titulo: string;
  total: number;
  itens: ItemDaConta[];
  onUsarValor?: () => void;
}) {
  if (itens.length === 0) return null;

  return (
    <section className="border-b py-2 last:border-b-0">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-bold">{titulo}</h3>
        <span className="flex items-center gap-2">
          <span className="tabular text-[14px] font-semibold">{formatCents(total)}</span>
          {onUsarValor && (
            <button
              type="button"
              onClick={onUsarValor}
              className="rounded px-2 py-0.5 text-[11px] text-muted-foreground underline underline-offset-2"
            >
              cobrar
            </button>
          )}
        </span>
      </header>

      <ul className="mt-1">
        {itens.map((item) => (
          <li key={item.id} className="flex justify-between gap-2 py-0.5 text-[13px]">
            <span className="min-w-0">
              {item.qty}× {item.produto}
              {item.modificadores.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({item.modificadores.join(', ')})
                </span>
              )}
              {item.status === 'pending' && (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  aguardando
                </span>
              )}
            </span>
            <span className="tabular shrink-0">{formatCents(item.totalCents)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Atalho({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 rounded-md border border-input px-3 text-[12px] font-semibold"
    >
      {children}
    </button>
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
