import { formatCents } from '@/lib/money';
import type { DiaDeVenda } from '@/lib/gestao/queries';

/**
 * Faturamento dia a dia (spec §8).
 *
 * Barras e não linha: cada dia é uma unidade fechada — o restaurante abriu,
 * vendeu, fechou. Linha sugere que existe algo entre terça e quarta.
 *
 * SÉRIE ÚNICA, logo sem legenda: o título já diz o que é. Legenda de um item só
 * ocupa espaço para repetir o cabeçalho.
 *
 * HTML E CSS, NÃO SVG — e a razão é específica do React 19.
 *
 * A primeira versão era SVG com `<title>` dentro de cada barra, que é como se
 * faz dica de ferramenta acessível em SVG. Só que o React 19 trata QUALQUER
 * `<title>` como metadado de documento e o iça para o `<head>`: o servidor
 * mandava seis `<title></title>` vazios, o cliente montava com o texto, e a
 * hidratação quebrava. O erro não fala de SVG nem de metadado — só diz que o
 * HTML do servidor não bateu.
 *
 * Em HTML, `title` é ATRIBUTO. Atributo não é içado, a dica é a nativa do
 * navegador, e o gráfico continua sem uma linha de JavaScript.
 */
export function GraficoDias({ dias }: { dias: DiaDeVenda[] }) {
  if (dias.length === 0) {
    return (
      <p className="py-12 text-center text-[13px] text-muted-foreground">
        Nenhuma comanda no período.
      </p>
    );
  }

  const pico = Math.max(...dias.map((d) => d.totalCents), 1);
  // Teto num número redondo acima do pico: escala que termina exatamente no
  // maior valor cola a barra mais alta no topo e não sobra lugar para o rótulo.
  const teto = arredondarParaCima(pico);

  const maior = dias.reduce((m, d) => (d.totalCents > m.totalCents ? d : m), dias[0]);
  // Em 90 dias não cabe uma data por barra.
  const salto = Math.ceil(dias.length / 10);

  return (
    <figure className="m-0">
      <div className="flex gap-2">
        {/* Eixo de valores. Três marcas bastam para dar escala; mais vira
            grade decorativa. */}
        <div className="relative h-44 w-10 shrink-0">
          {[1, 0.5, 0].map((f) => (
            <span
              key={f}
              style={{ bottom: `${f * 100}%` }}
              className="absolute right-0 translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
            >
              {emReais(teto * f)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-44">
            {/* Grade recessiva: presente para dar escala, nunca competindo com
                o dado. */}
            {[1, 0.5, 0].map((f) => (
              <div
                key={f}
                style={{ bottom: `${f * 100}%` }}
                className="pointer-events-none absolute inset-x-0 border-t border-border"
              />
            ))}

            <ol className="absolute inset-0 flex items-end gap-px">
              {dias.map((d) => (
                <li
                  key={d.dia}
                  // Alvo de mouse da COLUNA inteira: um dia fraco tem barra de
                  // 3px de altura, e mirar 3px com o mouse é impossível.
                  title={`${rotulo(d.dia)} — ${formatCents(d.totalCents)} · ${d.comandas} ${
                    d.comandas === 1 ? 'comanda' : 'comandas'
                  } · ${d.pessoas} ${d.pessoas === 1 ? 'pessoa' : 'pessoas'}`}
                  className="group relative flex h-full flex-1 items-end justify-center hover:bg-secondary/40"
                >
                  {d.dia === maior.dia && (
                    <span
                      style={{ bottom: `${(d.totalCents / teto) * 100}%` }}
                      className="pointer-events-none absolute mb-0.5 whitespace-nowrap text-[10px] font-bold tabular-nums"
                    >
                      {emReais(d.totalCents)}
                    </span>
                  )}

                  {/* Marca FINA com topo arredondado, ancorada na linha do zero.
                      Larga demais, a barra vira bloco e o olho compara área em
                      vez de altura — que é o que a barra existe para mostrar. */}
                  <span
                    style={{ height: `${Math.max(0.6, (d.totalCents / teto) * 100)}%` }}
                    className="w-full max-w-6 rounded-t-[4px] bg-[var(--chart-1)]"
                  />
                </li>
              ))}
            </ol>
          </div>

          <ol className="mt-1 flex gap-px" aria-hidden>
            {dias.map((d, i) => (
              <li
                key={d.dia}
                className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground"
              >
                {i % salto === 0 ? curto(d.dia) : ' '}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <figcaption className="mt-2 text-[11px] text-muted-foreground">
        Valores em reais. Passe o mouse para o detalhe do dia. Maior:{' '}
        {formatCents(maior.totalCents)} em {rotulo(maior.dia)}.
      </figcaption>
    </figure>
  );
}

/** Arredonda para meia-grandeza acima: 2.061 → 2.500; 20.610 → 25.000. */
function arredondarParaCima(cents: number): number {
  const reais = cents / 100;
  const grandeza = 10 ** Math.floor(Math.log10(Math.max(reais, 1)));
  return Math.ceil(reais / (grandeza / 2)) * (grandeza / 2) * 100;
}

/** Centavos → rótulo curto de eixo: 250000 → "2,5 mil". */
function emReais(cents: number): string {
  const reais = Math.round(cents / 100);
  if (reais >= 1000) {
    const mil = reais / 1000;
    return `${mil.toFixed(mil < 10 ? 1 : 0).replace('.', ',')} mil`;
  }
  return String(reais);
}

/** "2026-08-23" → "23/08" — sem `new Date`, que puxaria o fuso do servidor. */
function curto(dia: string): string {
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}

function rotulo(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}
