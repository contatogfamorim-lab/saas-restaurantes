'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangleIcon, PlusIcon, TrendingDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RotuloComAjuda } from '@/components/gestao/rotulo-com-ajuda';
import { formatCents } from '@/lib/money';
import { deMilesimos, NOME_DA_UNIDADE, UNIDADE_DE_COMPRA } from '@/lib/estoque/unidades';
import {
  criarInsumo,
  editarInsumo,
  movimentar,
} from '@/app/app/(gestao)/gestao/estoque/actions';

export interface Insumo {
  id: string;
  nome: string;
  unidade: string;
  quantidade: number;
  minimo: number;
  custoPorMilCents: number;
  valorCents: number;
  abaixoDoMinimo: boolean;
  negativo: boolean;
  pratosQueUsam: number;
}

export interface Prato {
  id: string;
  nome: string;
  precoCents: number;
  custoCents: number;
  itensNaFicha: number;
  porcoesPossiveis: number | null;
}

export interface Movimento {
  id: string;
  insumoId: string;
  tipo: string;
  delta: number;
  saldoDepois: number;
  motivo: string | null;
  quando: string;
}

const NOME_DO_MOVIMENTO: Record<string, string> = {
  entrada: 'Entrada',
  venda: 'Venda',
  devolucao: 'Devolução',
  perda: 'Perda',
  ajuste: 'Contagem',
};

export function Estoque({
  insumos,
  pratos,
  foraPorEstoque,
  movimentos,
}: {
  insumos: Insumo[];
  pratos: Prato[];
  foraPorEstoque: { id: string; nome: string }[];
  movimentos: Movimento[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const alertas = insumos.filter((i) => i.negativo || i.abaixoDoMinimo);
  const valorTotal = insumos.reduce((s, i) => s + Math.max(i.valorCents, 0), 0);

  return (
    <>
      {/*
        O QUE ESTÁ ACABANDO vem antes de tudo.

        Uma lista alfabética de insumos é um relatório; isto é um aviso. Quem
        abre esta tela às 18h quer saber o que vai faltar às 21h, não conferir
        o alfabeto.
      */}
      {alertas.length > 0 && (
        <div className="mb-4 rounded-xl border border-alert-warning/40 bg-alert-warning/5 p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <AlertTriangleIcon className="size-4 text-alert-warning" />
            {alertas.length === 1 ? 'Um insumo pede atenção' : `${alertas.length} insumos pedem atenção`}
          </p>
          <ul className="mt-2 space-y-1">
            {alertas.map((i) => (
              <li key={i.id} className="text-[13px] text-muted-foreground">
                <strong className="text-foreground">{i.nome}</strong>
                {i.negativo ? (
                  <>
                    {' '}está <span className="text-alert-critical">negativo</span> em{' '}
                    {deMilesimos(Math.abs(i.quantidade))} {NOME_DA_UNIDADE[i.unidade]} — saiu
                    mais do que o sistema tinha registrado. Vale contar.
                  </>
                ) : (
                  <>
                    {' '}tem {deMilesimos(i.quantidade)} {NOME_DA_UNIDADE[i.unidade]}, abaixo
                    do mínimo de {deMilesimos(i.minimo)}.
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {foraPorEstoque.length > 0 && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <p className="text-[13px] font-semibold">
            {foraPorEstoque.length === 1
              ? 'Um prato saiu do cardápio por falta de ingrediente'
              : `${foraPorEstoque.length} pratos saíram do cardápio por falta de ingrediente`}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {foraPorEstoque.map((p) => p.nome).join(', ')}. O sistema tirou sozinho
            quando o que sobrou deixou de fazer uma porção. Repor o estoque{' '}
            <strong className="text-foreground">não</strong> devolve o prato ao ar —
            isso é decisão sua, no{' '}
            <Link href="/app/cardapio" className="underline">
              cardápio
            </Link>
            .
          </p>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Cartao rotulo="Insumos" valor={String(insumos.length)} detalhe="cadastrados" />
        <Cartao
          rotulo="Parado no estoque"
          valor={formatCents(valorTotal)}
          detalhe="pelo custo cadastrado"
        />
        <Cartao
          rotulo="Pratos com ficha"
          valor={String(pratos.length)}
          detalhe={
            pratos.length === 0
              ? 'sem ficha, nada baixa sozinho'
              : 'baixam estoque ao ir para a cozinha'
          }
          tom={pratos.length === 0 ? 'atencao' : 'neutro'}
        />
      </div>

      {erro && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical"
        >
          {erro}
        </p>
      )}

      {criando ? (
        <NovoInsumo onFechar={() => setCriando(false)} onErro={setErro} />
      ) : (
        <button
          type="button"
          onClick={() => {
            setErro(null);
            setCriando(true);
          }}
          className="mb-4 flex h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-[14px] font-semibold text-background"
        >
          <PlusIcon className="size-4" />
          Novo insumo
        </button>
      )}

      <div className="space-y-2">
        {insumos.length === 0 && !criando && (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-[13px] leading-relaxed text-muted-foreground">
            Nenhum insumo ainda.
            <br />
            Sem ficha técnica nada baixa sozinho.
          </p>
        )}

        {insumos.map((i) => (
          <LinhaInsumo
            key={i.id}
            insumo={i}
            aberto={aberto === i.id}
            movimentos={movimentos.filter((m) => m.insumoId === i.id)}
            onAbrir={() => setAberto(aberto === i.id ? null : i.id)}
            onErro={setErro}
          />
        ))}
      </div>

      {pratos.length > 0 && (
        <div className="mt-6">
          <h2 className="text-[12px] font-bold tracking-wide text-muted-foreground uppercase">
            Custo dos pratos
          </h2>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead className="border-b border-border bg-card">
                <tr className="text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                  <th className="px-3 py-2 font-semibold">Prato</th>
                  <th className="px-3 py-2 font-semibold">Custo</th>
                  <th className="px-3 py-2 font-semibold">Preço</th>
                  <th className="px-3 py-2 font-semibold">Margem</th>
                  <th className="px-3 py-2 font-semibold">Dá para</th>
                </tr>
              </thead>
              <tbody>
                {pratos.map((p) => {
                  const margem =
                    p.precoCents > 0
                      ? Math.round(((p.precoCents - p.custoCents) / p.precoCents) * 100)
                      : null;
                  return (
                    <tr key={p.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-medium">{p.nome}</td>
                      <td className="px-3 py-2 tabular-nums">{formatCents(p.custoCents)}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {formatCents(p.precoCents)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 tabular-nums',
                          margem !== null && margem < 50 && 'text-alert-warning',
                          margem !== null && margem < 0 && 'text-alert-critical',
                        )}
                      >
                        {margem === null ? '—' : `${margem}%`}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {p.porcoesPossiveis === null
                          ? '—'
                          : `${p.porcoesPossiveis} ${p.porcoesPossiveis === 1 ? 'porção' : 'porções'}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            O custo vem da ficha técnica. &ldquo;Dá para&rdquo; é quantas
            porções ainda saem com o que há na casa.
          </p>
        </div>
      )}

      {/*
        Três parágrafos com o porquê de cada regra viraram três fatos. O
        raciocínio ("o pedido ainda pode ser recusado", "o cliente está
        sentado") era defesa de decisão de projeto, não informação de operação.
      */}
      <ul className="mt-6 space-y-1.5 border-t border-border pt-4 text-[11px] text-muted-foreground">
        <li>
          <strong className="text-foreground">Baixa quando o item vai para a cozinha</strong>
          {' '}— não quando o cliente pede.
        </li>
        <li>
          <strong className="text-foreground">Falta de estoque nunca recusa um pedido.</strong>
          {' '}O saldo fica negativo e aparece aqui em cima.
        </li>
        <li>
          Item recusado antes de a cozinha começar devolve o ingrediente. Depois
          disso é <strong className="text-foreground">perda</strong>, e você
          registra em Perdas.
        </li>
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------

function Cartao({
  rotulo,
  valor,
  detalhe,
  tom,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  tom?: 'neutro' | 'atencao';
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {rotulo}
      </p>
      <p
        className={cn(
          'font-display mt-1 text-2xl leading-none',
          tom === 'atencao' && 'text-alert-warning',
        )}
      >
        {valor}
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground">{detalhe}</p>
    </div>
  );
}

const CAMPO =
  'mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand';

function NovoInsumo({
  onFechar,
  onErro,
}: {
  onFechar: () => void;
  onErro: (e: string | null) => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [unidade, setUnidade] = useState('g');

  return (
    <form
      action={(fd) => {
        onErro(null);
        iniciar(async () => {
          const r = await criarInsumo(fd);
          if (!r.ok) {
            onErro(r.erro ?? 'Não deu certo');
            return;
          }
          onFechar();
        });
      }}
      className="mb-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="text-[12px] font-semibold text-muted-foreground">Nome</span>
          <input name="nome" required minLength={2} maxLength={80} autoFocus className={CAMPO} />
        </label>

        <label className="block">
          <RotuloComAjuda ajuda="Não dá para trocar depois — mudaria toda receita que aponta para o insumo.">
            Unidade
          </RotuloComAjuda>
          <select
            name="unidade"
            value={unidade}
            onChange={(e) => setUnidade(e.target.value)}
            className={CAMPO}
          >
            <option value="g">gramas</option>
            <option value="ml">mililitros</option>
            <option value="un">unidades</option>
          </select>
        </label>

        <label className="block">
          <RotuloComAjuda ajuda="Em reais. Opcional — sem ele o sistema não calcula margem.">
            Custo por {UNIDADE_DE_COMPRA[unidade]}
          </RotuloComAjuda>
          <input name="custo" inputMode="decimal" placeholder="45,00" className={CAMPO} />
        </label>

        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Avisar abaixo de ({NOME_DA_UNIDADE[unidade]})
          </span>
          <input name="minimo" inputMode="decimal" placeholder="0" className={CAMPO} />
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pendente}
          className="h-10 rounded-lg bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40"
        >
          {pendente ? 'Criando…' : 'Criar insumo'}
        </button>
        <button
          type="button"
          onClick={onFechar}
          className="h-10 rounded-lg px-4 text-[13px] text-muted-foreground"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function LinhaInsumo({
  insumo: i,
  aberto,
  movimentos,
  onAbrir,
  onErro,
}: {
  insumo: Insumo;
  aberto: boolean;
  movimentos: Movimento[];
  onAbrir: () => void;
  onErro: (e: string | null) => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [tipo, setTipo] = useState<'entrada' | 'perda' | 'contagem'>('entrada');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const [editando, setEditando] = useState(false);

  function enviar() {
    onErro(null);
    iniciar(async () => {
      const r = await movimentar(i.id, tipo, quantidade, motivo, i.quantidade);
      if (!r.ok) {
        onErro(r.erro ?? 'Não deu certo');
        return;
      }
      setQuantidade('');
      setMotivo('');
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{i.nome}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {i.pratosQueUsam === 0
              ? 'nenhum prato usa'
              : `${i.pratosQueUsam} ${i.pratosQueUsam === 1 ? 'prato usa' : 'pratos usam'}`}
            {i.custoPorMilCents > 0 && (
              <> · {formatCents(i.custoPorMilCents)}/{UNIDADE_DE_COMPRA[i.unidade]}</>
            )}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span
            className={cn(
              'block text-[15px] font-semibold tabular-nums',
              i.negativo && 'text-alert-critical',
              !i.negativo && i.abaixoDoMinimo && 'text-alert-warning',
            )}
          >
            {deMilesimos(i.quantidade)}{' '}
            <span className="text-[12px] font-normal text-muted-foreground">
              {NOME_DA_UNIDADE[i.unidade]}
            </span>
          </span>
          {i.minimo > 0 && (
            <span className="block text-[11px] text-muted-foreground">
              mín. {deMilesimos(i.minimo)}
            </span>
          )}
        </span>
      </button>

      {aberto && (
        <div className="border-t border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              {(['entrada', 'perda', 'contagem'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={cn(
                    'h-8 rounded-md px-3 text-[12px] font-medium capitalize',
                    tipo === t ? 'bg-secondary text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="text-[11px] text-muted-foreground">
                {/*
                  A contagem pede o SALDO, não a diferença. Perguntar "quanto
                  sobrou a mais ou a menos" seria pedir que a pessoa fizesse a
                  subtração — e a subtração é justamente o que ela veio conferir.
                */}
                {tipo === 'contagem'
                  ? `Quanto tem de verdade (${NOME_DA_UNIDADE[i.unidade]})`
                  : `Quantidade (${NOME_DA_UNIDADE[i.unidade]})`}
              </span>
              <input
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className={cn(CAMPO, 'w-32')}
              />
            </label>

            <label className="block min-w-[8rem] flex-1">
              <span className="text-[11px] text-muted-foreground">
                Motivo {tipo === 'entrada' ? '(nota, fornecedor)' : '(opcional)'}
              </span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={120}
                className={CAMPO}
              />
            </label>

            <button
              type="button"
              onClick={enviar}
              disabled={pendente || quantidade.trim() === ''}
              className="h-10 rounded-lg bg-brand px-4 text-[13px] font-semibold text-background disabled:opacity-40"
            >
              {pendente ? '…' : 'Registrar'}
            </button>
          </div>

          {/*
            Corrigir o cadastro.

            Estava faltando, e a falta era pior do que parece: quem errasse o
            mínimo ou o custo na criação não teria como consertar — o insumo
            ficaria avisando errado para sempre, ou seria recriado com outro
            nome, que é como um estoque começa a ter dois "Queijo".

            A UNIDADE não está aqui. Trocar g por ml reinterpretaria toda
            receita que aponta para este insumo, em silêncio.
          */}
          {editando ? (
            <form
              action={(fd) => {
                onErro(null);
                iniciar(async () => {
                  const r = await editarInsumo(i.id, fd);
                  if (!r.ok) {
                    onErro(r.erro ?? 'Não deu certo');
                    return;
                  }
                  setEditando(false);
                });
              }}
              className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-secondary/50 p-3"
            >
              <label className="block min-w-[8rem] flex-1">
                <span className="text-[11px] text-muted-foreground">Nome</span>
                <input name="nome" defaultValue={i.nome} maxLength={80} className={CAMPO} />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">
                  Custo por {UNIDADE_DE_COMPRA[i.unidade]}
                </span>
                <input
                  name="custo"
                  defaultValue={
                    i.custoPorMilCents > 0 ? (i.custoPorMilCents / 100).toFixed(2).replace('.', ',') : ''
                  }
                  inputMode="decimal"
                  className={cn(CAMPO, 'w-28')}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">
                  Avisar abaixo de ({NOME_DA_UNIDADE[i.unidade]})
                </span>
                <input
                  name="minimo"
                  defaultValue={deMilesimos(i.minimo)}
                  inputMode="decimal"
                  className={cn(CAMPO, 'w-28')}
                />
              </label>
              <button
                type="submit"
                disabled={pendente}
                className="h-10 rounded-lg bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40"
              >
                {pendente ? '…' : 'Salvar'}
              </button>
              <button
                type="button"
                onClick={() => setEditando(false)}
                className="h-10 rounded-lg px-3 text-[13px] text-muted-foreground"
              >
                Cancelar
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                onErro(null);
                setEditando(true);
              }}
              className="mb-3 text-[12px] text-muted-foreground underline"
            >
              Corrigir nome, custo ou mínimo
            </button>
          )}

          {tipo === 'contagem' && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              O sistema acha que tem{' '}
              <strong className="text-foreground">
                {deMilesimos(i.quantidade)} {NOME_DA_UNIDADE[i.unidade]}
              </strong>
              . A diferença vira um ajuste, com seu nome.
            </p>
          )}

          {movimentos.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Últimos movimentos
              </p>
              <ul className="mt-1.5 space-y-1">
                {movimentos.slice(0, 8).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-baseline justify-between gap-3 text-[12px]"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {NOME_DO_MOVIMENTO[m.tipo] ?? m.tipo}
                      {m.motivo && <> · {m.motivo}</>}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <span className={cn(m.delta < 0 ? 'text-muted-foreground' : 'text-brand')}>
                        {m.delta > 0 ? '+' : ''}
                        {deMilesimos(m.delta)}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        → {deMilesimos(m.saldoDepois)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {movimentos.length === 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <TrendingDownIcon className="size-3" />
              Nenhum movimento ainda.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
