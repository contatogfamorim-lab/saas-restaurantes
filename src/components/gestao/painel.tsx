import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Peças de layout do console (spec §8).
 *
 * Densidade alta de propósito: o dono compara sete números de uma vez, e cada
 * pixel de respiro a mais é uma linha a menos na tela. Nada aqui tem alvo de
 * 44px — isto é mouse, não polegar.
 */

export function Cartao({
  titulo,
  acao,
  children,
  className,
}: {
  titulo: string;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          {titulo}
        </h2>
        {acao}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Número grande com rótulo.
 *
 * A variação vem ao lado do valor e não embaixo: lida junto, ela é a diferença
 * entre "R$ 12 mil" e "R$ 12 mil, 18% abaixo da semana passada" — e é a
 * segunda leitura que faz alguém agir.
 */
export function Numero({
  rotulo,
  valor,
  detalhe,
  variacao,
  tom = 'neutro',
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  variacao?: number | null;
  tom?: 'neutro' | 'bom' | 'alerta' | 'ruim';
}) {
  const cores = {
    neutro: 'text-foreground',
    bom: 'text-alert-calm',
    alerta: 'text-alert-warning',
    ruim: 'text-alert-critical',
  } as const;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn('font-display text-2xl leading-none tabular-nums', cores[tom])}>
          {valor}
        </span>
        {variacao != null && <Variacao pct={variacao} />}
      </div>
      {detalhe && <p className="mt-1 text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function Variacao({ pct }: { pct: number }) {
  // Zero não é subida nem queda. Pintar de verde um empate seria mentir de leve.
  const cor =
    pct > 0 ? 'text-alert-calm' : pct < 0 ? 'text-alert-critical' : 'text-muted-foreground';
  const sinal = pct > 0 ? '+' : '';

  return (
    <span className={cn('text-[12px] font-semibold tabular-nums', cor)}>
      {sinal}
      {pct}%
    </span>
  );
}

/** Tabela densa, com rolagem horizontal própria em tela estreita. */
export function Tabela({
  colunas,
  children,
}: {
  colunas: readonly (string | { rotulo: string; alinhar?: 'direita' })[];
  children: ReactNode;
}) {
  return (
    <div className="-mx-4 -mb-4 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {colunas.map((c, i) => {
              const rotulo = typeof c === 'string' ? c : c.rotulo;
              const direita = typeof c !== 'string' && c.alinhar === 'direita';
              return (
                <th
                  key={i}
                  scope="col"
                  className={cn(
                    'px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
                    direita ? 'text-right' : 'text-left',
                  )}
                >
                  {rotulo}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Linha({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border/50 last:border-0">{children}</tr>;
}

export function Celula({
  children,
  direita,
  fraca,
  className,
}: {
  children: ReactNode;
  direita?: boolean;
  fraca?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        'px-4 py-2',
        direita && 'text-right tabular-nums',
        fraca && 'text-muted-foreground',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return (
    <p className="py-10 text-center text-[13px] text-muted-foreground">{children}</p>
  );
}
