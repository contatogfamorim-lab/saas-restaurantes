import { formatCents } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Composição de um total — meios de pagamento, categorias, o que for (spec §8).
 *
 * Uma barra empilhada mais a lista com os valores escritos ao lado. Os dois
 * juntos, não um ou outro: no tema claro três das cores de série ficam abaixo
 * de 3:1 contra o branco, e a regra é que cor com contraste baixo só vale
 * acompanhada de rótulo visível. A lista é esse rótulo — e de quebra é a
 * "vista em tabela" que a identidade nunca depende só de cor.
 *
 * Até cinco fatias. A sexta em diante vira "outros", porque a paleta tem cinco
 * posições medidas e inventar uma sexta cor é justamente o erro que a validação
 * existe para impedir.
 */
export interface Fatia {
  rotulo: string;
  valorCents: number;
  detalhe?: string;
}

const MAXIMO = 5;

export function BarraComposicao({ fatias }: { fatias: Fatia[] }) {
  if (fatias.length === 0) {
    return <p className="py-8 text-center text-[13px] text-muted-foreground">Sem dados.</p>;
  }

  const ordenadas = [...fatias].sort((a, b) => b.valorCents - a.valorCents);
  const visiveis = ordenadas.slice(0, MAXIMO);
  const resto = ordenadas.slice(MAXIMO);

  const lista: Fatia[] =
    resto.length > 0
      ? [
          ...visiveis,
          {
            rotulo: 'outros',
            valorCents: resto.reduce((s, f) => s + f.valorCents, 0),
            detalhe: `${resto.length} itens`,
          },
        ]
      : visiveis;

  const total = lista.reduce((s, f) => s + f.valorCents, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-[13px] text-muted-foreground">Sem dados.</p>;
  }

  return (
    <div>
      {/* 2px de fundo entre segmentos — o mesmo respiro das barras vizinhas.
          Sem ele, duas fatias de cor próxima viram uma só. */}
      <div className="flex h-3 gap-0.5 overflow-hidden rounded">
        {lista.map((f, i) => (
          <div
            key={f.rotulo}
            style={{
              width: `${(f.valorCents / total) * 100}%`,
              background: corDaSerie(i),
            }}
            className="h-full first:rounded-l last:rounded-r"
          />
        ))}
      </div>

      <ul className="mt-3 space-y-1.5">
        {lista.map((f, i) => (
          <li key={f.rotulo} className="flex items-center gap-2 text-[13px]">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: corDaSerie(i) }}
            />
            <span className="capitalize">{f.rotulo}</span>
            <span className="flex-1 border-b border-dashed border-border/60" />
            {f.detalhe && (
              <span className="text-[11px] text-muted-foreground">{f.detalhe}</span>
            )}
            <span className="tabular-nums font-medium">{formatCents(f.valorCents)}</span>
            <span className={cn('w-9 text-right text-[11px] tabular-nums text-muted-foreground')}>
              {Math.round((f.valorCents / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Posição fixa na paleta, sempre na mesma ordem.
 *
 * A sexta fatia não ganha matiz nova — ela já foi dobrada em "outros" antes de
 * chegar aqui, e o cinza é o que sobra para esse caso.
 */
function corDaSerie(i: number): string {
  return i < MAXIMO ? `var(--chart-${i + 1})` : 'var(--muted-foreground)';
}
