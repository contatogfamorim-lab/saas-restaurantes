'use client';

import { useState, useTransition } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import { deMilesimos, NOME_DA_UNIDADE, paraMilesimos } from '@/lib/estoque/unidades';
import {
  removerDaFicha,
  salvarNaFicha,
} from '@/app/app/(gestao)/gestao/estoque/actions';

export interface InsumoDisponivel {
  id: string;
  nome: string;
  unidade: string;
  custoPorMilCents: number;
  quantidade: number;
}

export interface LinhaDaFicha {
  insumoId: string;
  nome: string;
  unidade: string;
  quantidade: number;
  custoPorMilCents: number;
}

/**
 * A ficha técnica de um prato.
 *
 * Vive no editor do item, e não numa tela própria de estoque, porque é aqui que
 * a pessoa está quando pensa no prato. Uma tela separada obrigaria a lembrar o
 * nome do prato, sair, procurar, e voltar.
 *
 * O QUE ELA MOSTRA E POR QUÊ
 *
 * O custo total ao lado do preço. É a pergunta que a ficha técnica existe para
 * responder — "este prato dá lucro?" — e ela some se o custo ficar em outra
 * tela.
 *
 * E o aviso de que cadastrar ficha LIGA a baixa automática. Antes de existir
 * uma linha aqui, o prato não mexe em estoque nenhum; depois da primeira, ele
 * passa a descontar toda vez que for para a cozinha. É uma mudança de
 * comportamento silenciosa, e silenciosa é como ela viraria surpresa.
 */
export function FichaTecnica({
  produtoId,
  precoCents,
  linhas,
  disponiveis,
  liberado,
}: {
  produtoId: string;
  precoCents: number;
  linhas: LinhaDaFicha[];
  disponiveis: InsumoDisponivel[];
  liberado: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [insumoId, setInsumoId] = useState('');
  const [quantidade, setQuantidade] = useState('');

  const custoTotal = linhas.reduce(
    (s, l) => s + Math.trunc((l.quantidade * l.custoPorMilCents) / 1_000_000),
    0,
  );
  const margem =
    precoCents > 0 ? Math.round(((precoCents - custoTotal) / precoCents) * 100) : null;

  // Insumo já na ficha não aparece de novo: repetir a linha não é uma
  // operação — editar o número é.
  const naFicha = new Set(linhas.map((l) => l.insumoId));
  const podeAdicionar = disponiveis.filter((i) => !naFicha.has(i.id));

  const escolhido = disponiveis.find((i) => i.id === insumoId);

  function adicionar() {
    setErro(null);
    if (!insumoId) return;
    const valor = paraMilesimos(quantidade);
    if (valor === null || valor <= 0) {
      setErro('Quantidade precisa ser um número maior que zero');
      return;
    }
    iniciar(async () => {
      const r = await salvarNaFicha(produtoId, insumoId, quantidade);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      setInsumoId('');
      setQuantidade('');
      setAdicionando(false);
    });
  }

  if (!liberado) return null;

  return (
    <section className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-bold tracking-wide text-muted-foreground uppercase">
          Ficha técnica
        </h2>
        {linhas.length > 0 && (
          <p className="text-[12px] tabular-nums text-muted-foreground">
            custo{' '}
            <strong className="text-foreground">{formatCents(custoTotal)}</strong>
            {margem !== null && (
              <>
                {' '}· margem{' '}
                <strong
                  className={cn(
                    margem < 0 && 'text-alert-critical',
                    margem >= 0 && margem < 50 && 'text-alert-warning',
                    margem >= 50 && 'text-brand',
                  )}
                >
                  {margem}%
                </strong>
              </>
            )}
          </p>
        )}
      </div>

      {disponiveis.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          Nenhum insumo cadastrado ainda. Cadastre em{' '}
          <a href="/app/gestao/estoque" className="underline">
            Estoque
          </a>{' '}
          para poder montar a ficha deste prato.
        </p>
      ) : (
        <>
          {linhas.length === 0 && !adicionando && (
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              Este prato não desconta nada do estoque. Ao acrescentar o primeiro
              insumo, ele passa a descontar toda vez que for para a cozinha.
            </p>
          )}

          {linhas.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {linhas.map((l) => (
                <LinhaEditavel
                  key={l.insumoId}
                  produtoId={produtoId}
                  linha={l}
                  onErro={setErro}
                />
              ))}
            </ul>
          )}

          {adicionando ? (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-secondary/50 p-3">
              <label className="block min-w-[10rem] flex-1">
                <span className="text-[11px] text-muted-foreground">Insumo</span>
                <select
                  value={insumoId}
                  onChange={(e) => setInsumoId(e.target.value)}
                  autoFocus
                  className={CAMPO}
                >
                  <option value="">escolha…</option>
                  {podeAdicionar.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome} ({NOME_DA_UNIDADE[i.unidade]})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[11px] text-muted-foreground">
                  Por porção {escolhido && `(${NOME_DA_UNIDADE[escolhido.unidade]})`}
                </span>
                <input
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  inputMode="decimal"
                  placeholder="150"
                  className={cn(CAMPO, 'w-28')}
                />
              </label>

              <button
                type="button"
                onClick={adicionar}
                disabled={pendente || !insumoId || quantidade.trim() === ''}
                className="h-10 rounded-lg bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40"
              >
                {pendente ? '…' : 'Acrescentar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdicionando(false);
                  setErro(null);
                }}
                className="h-10 rounded-lg px-3 text-[13px] text-muted-foreground"
              >
                Cancelar
              </button>
            </div>
          ) : (
            podeAdicionar.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setErro(null);
                  setAdicionando(true);
                }}
                className="mt-3 flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium"
              >
                <PlusIcon className="size-3.5" />
                Acrescentar insumo
              </button>
            )
          )}
        </>
      )}

      {erro && (
        <p role="alert" className="mt-2 text-[12px] text-alert-critical">
          {erro}
        </p>
      )}

      {linhas.length > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          A baixa acontece quando o item vai para a cozinha, multiplicada pela
          quantidade pedida. Quando o que sobrar não fizer mais uma porção, o
          prato sai do cardápio sozinho — e voltar é decisão sua.
        </p>
      )}
    </section>
  );
}

const CAMPO =
  'mt-1 h-10 w-full rounded-lg border border-border bg-background px-2.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand';

function LinhaEditavel({
  produtoId,
  linha: l,
  onErro,
}: {
  produtoId: string;
  linha: LinhaDaFicha;
  onErro: (e: string | null) => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [valor, setValor] = useState(deMilesimos(l.quantidade));

  const custo = Math.trunc((l.quantidade * l.custoPorMilCents) / 1_000_000);
  const original = deMilesimos(l.quantidade);

  function salvar() {
    if (valor === original) return;
    onErro(null);
    iniciar(async () => {
      const r = await salvarNaFicha(produtoId, l.insumoId, valor);
      if (!r.ok) {
        onErro(r.erro ?? 'Não deu certo');
        setValor(original);
      }
    });
  }

  return (
    <li className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[14px]">{l.nome}</span>

      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={salvar}
        inputMode="decimal"
        disabled={pendente}
        className="h-9 w-20 rounded-lg border border-border bg-background px-2 text-right text-[14px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand"
      />
      <span className="w-8 text-[12px] text-muted-foreground">
        {NOME_DA_UNIDADE[l.unidade]}
      </span>

      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
        {l.custoPorMilCents > 0 ? formatCents(custo) : '—'}
      </span>

      <button
        type="button"
        onClick={() =>
          iniciar(async () => {
            const r = await removerDaFicha(produtoId, l.insumoId);
            if (!r.ok) onErro(r.erro ?? 'Não deu certo');
          })
        }
        disabled={pendente}
        aria-label={`Tirar ${l.nome} da ficha`}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </li>
  );
}
