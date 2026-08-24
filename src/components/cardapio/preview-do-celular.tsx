'use client';

import { formatCents } from '@/lib/money';
import { DIET_LABELS, PRODUCT_BADGE_LABELS, servesLabel } from '@/lib/menu/labels';
import type { DietTag, ProductBadge } from '@/lib/menu/types';

/**
 * Como o item aparece no celular do cliente.
 *
 * A razão de existir: quem edita cardápio decide olhando uma tabela e o cliente
 * decide olhando um card com foto. São duas coisas diferentes, e a distância
 * entre elas é onde nascem os cardápios ruins — nome que quebra em três linhas,
 * descrição que o `line-clamp` corta no meio, foto escura que some no tema
 * noturno. Nada disso aparece num formulário.
 *
 * A MOLDURA é uma imitação; o CONTEÚDO não. As medidas, a hierarquia e o
 * corte de duas linhas na descrição são os mesmos de `menu/product-card.tsx`,
 * porque um preview aproximado é pior que nenhum: dá confiança sem dar
 * informação.
 *
 * Por que não importar o `ProductCard` de verdade: ele recebe um `MenuProduct`
 * montado pela consulta do cardápio, que aplica promoção, junta modificadores e
 * resolve preço efetivo pela view. Montar esse objeto no editor a partir de um
 * rascunho não salvo significaria reimplementar a regra de preço — e um preview
 * com regra de preço PRÓPRIA mostraria um valor que o cliente talvez não veja.
 * Aqui o preço vem cru do campo, e a tela diz isso.
 */
export function PreviewDoCelular({
  nome,
  descricao,
  precoCents,
  fotoUrl,
  servePessoas,
  dietTags,
  badges,
  disponivel,
}: {
  nome: string;
  descricao: string | null;
  precoCents: number;
  fotoUrl: string | null;
  servePessoas: number;
  dietTags: string[];
  badges: string[];
  disponivel: boolean;
}) {
  const serve = servesLabel(servePessoas);

  return (
    <div className="sticky top-20">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        No celular do cliente
      </p>

      {/* Moldura de celular: 375 px é a largura real do alvo da §11. */}
      <div className="mx-auto w-[375px] max-w-full overflow-hidden rounded-[28px] border-8 border-neutral-800 bg-background shadow-2xl">
        <div className="flex h-6 items-center justify-center bg-neutral-800">
          <div className="h-1 w-16 rounded-full bg-neutral-600" />
        </div>

        <div className="px-3 py-3">
          <div className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left">
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {badges.map((b) => (
                  <span
                    key={b}
                    className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent-foreground"
                  >
                    {PRODUCT_BADGE_LABELS[b as ProductBadge] ?? b}
                  </span>
                ))}
              </div>

              <h3 className="font-display mt-1 text-[19px] leading-tight text-foreground">
                {nome || 'Sem nome'}
              </h3>

              {descricao && (
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
                  {descricao}
                </p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="tabular text-[15px] font-semibold">
                  {formatCents(precoCents)}
                </span>
                {serve && (
                  <span className="text-[11px] text-muted-foreground">· {serve}</span>
                )}
              </div>

              {dietTags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {dietTags.map((t) => (
                    <span
                      key={t}
                      className="rounded-sm border border-border px-1 py-0.5 text-[9px] font-semibold tracking-wide text-muted-foreground"
                    >
                      {DIET_LABELS[t as DietTag]?.short ?? t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="relative size-24 shrink-0 overflow-hidden rounded-lg bg-secondary">
              {fotoUrl ? (
                // <img> e não next/image: a URL pode ser um blob local do
                // arquivo que a pessoa acabou de escolher, e o otimizador do
                // Next não sabe buscar blob.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fotoUrl}
                  alt=""
                  className={`size-full object-cover ${disponivel ? '' : 'grayscale'}`}
                />
              ) : (
                <div className="flex size-full items-center justify-center px-2 text-center text-[10px] leading-tight text-muted-foreground">
                  sem foto
                </div>
              )}
            </div>
          </div>

          {!disponivel && (
            <p className="mt-1 rounded-md bg-muted px-3 py-2 text-center text-[12px] text-muted-foreground">
              Fora do ar: o cliente não vê este item.
            </p>
          )}
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
        Preço sem promoção aplicada. A promoção vigente entra na hora de montar o
        cardápio.
      </p>
    </div>
  );
}
