'use client';

import { formatCents, discountPercent } from '@/lib/money';
import type { MenuProduct } from '@/lib/menu/types';

import { ProductImage } from './product-image';

/**
 * "Hoje na casa" — carrossel das promoções vivas neste instante (spec §4).
 *
 * É a primeira coisa que o cliente vê, e some sozinho quando não há promoção
 * ativa: a lista vem da view `live_promotions`, que já aplica horário, dia da
 * semana e estoque. Bloco vazio com título "Hoje na casa" seria pior que
 * bloco nenhum.
 */
interface Props {
  products: MenuProduct[];
  onOpen: (product: MenuProduct) => void;
}

export function PromoRail({ products, onOpen }: Props) {
  if (products.length === 0) return null;

  return (
    <section aria-labelledby="hoje-na-casa" className="pt-4">
      <h2
        id="hoje-na-casa"
        className="font-display px-4 text-[15px] uppercase tracking-wide text-muted-foreground"
      >
        Hoje na casa
      </h2>

      <div className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((product) => {
          const percent = product.originalPriceCents
            ? discountPercent(product.originalPriceCents, product.priceCents)
            : 0;

          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onOpen(product)}
              className="w-[168px] shrink-0 snap-start text-left"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
                <ProductImage name={product.name} url={product.imageUrl} sizes="168px" priority />
                {product.promotion && (
                  <span
                    className="absolute left-1.5 top-1.5 rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white shadow-sm"
                    style={{ backgroundColor: product.promotion.color ?? 'var(--primary)' }}
                  >
                    {product.promotion.label}
                  </span>
                )}
              </div>

              <h3 className="font-display mt-1.5 line-clamp-1 text-[15px] leading-tight">
                {product.name}
              </h3>

              <div className="flex items-baseline gap-1.5">
                <span className="tabular text-[14px] font-semibold">
                  {formatCents(product.priceCents)}
                </span>
                {product.originalPriceCents && (
                  <span className="tabular text-[12px] text-muted-foreground line-through">
                    {formatCents(product.originalPriceCents)}
                  </span>
                )}
              </div>

              {percent > 0 && (
                <span className="text-[11px] font-semibold text-primary">−{percent}%</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
