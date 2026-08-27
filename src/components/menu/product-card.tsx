'use client';

import { formatCents, discountPercent } from '@/lib/money';
import { servesLabel } from '@/lib/menu/labels';
import { Selo } from './selo';
import type { RestricaoDoCardapio, SeloDoCardapio } from '@/lib/menu/types';
import type { MenuProduct } from '@/lib/menu/types';

import { ProductImage } from './product-image';

/**
 * Card do produto na lista.
 *
 * Foto à direita e texto à esquerda, não o contrário: o polegar direito cobre
 * a borda direita da tela, e a foto é o alvo de toque mais óbvio. Linha inteira
 * é clicável mesmo assim.
 *
 * Hierarquia: nome em condensada pesada, preço logo abaixo em tabular, e a
 * descrição em terceiro — o cliente decide pela foto e pelo nome; a descrição
 * só confirma (spec §11).
 */
interface Props {
  product: MenuProduct;
  onOpen: (product: MenuProduct) => void;
  priority?: boolean;
  /** Quantas unidades deste produto já estão no carrinho. */
  inCart?: number;
  /** Definições dos selos da casa — cor e animação. */
  selos: SeloDoCardapio[];
  /** Definições das restrições da casa — cor, sem animação. */
  restricoes: RestricaoDoCardapio[];
}

export function ProductCard({ product, onOpen, priority, inCart = 0, selos, restricoes }: Props) {
  const hasDiscount = product.originalPriceCents !== null;
  const percent = hasDiscount
    ? discountPercent(product.originalPriceCents!, product.priceCents)
    : 0;
  const serves = servesLabel(product.servesPeople);

  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      className="group relative flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-accent/60 sm:gap-4"
    >
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Selo desconhecido some em silêncio: a casa pode ter desativado
              um selo que ainda está em produtos antigos, e um retângulo vazio
              no card seria pior que a ausência. */}
          {product.badges.map((slug) => {
            const selo = selos.find((s) => s.slug === slug);
            return selo ? <Selo key={slug} selo={selo} /> : null;
          })}
        </div>

        <h3 className="font-display mt-1 text-[19px] leading-tight text-foreground">
          {product.name}
        </h3>

        {product.description && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {product.description}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="tabular text-[15px] font-semibold text-foreground">
            {formatCents(product.priceCents)}
          </span>
          {hasDiscount && (
            <>
              <span className="tabular text-[13px] text-muted-foreground line-through">
                {formatCents(product.originalPriceCents!)}
              </span>
              {percent > 0 && (
                <span className="text-[12px] font-semibold text-primary">−{percent}%</span>
              )}
            </>
          )}
        </div>

        {(product.dietTags.length > 0 || serves) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {serves && (
              <span className="text-[11px] text-muted-foreground">{serves}</span>
            )}
            {/* Restrição pintada, e não cinza como o resto da linha.
                Quem procura "sem glúten" varre a lista com o olho — cinza igual
                ao "Serve 2 pessoas" ao lado obriga a LER cada uma.
                Sem animação de propósito: aviso de alergia não é vitrine. */}
            {product.dietTags.map((slug) => {
              const r = restricoes.find((x) => x.slug === slug);
              if (!r) return null;
              return (
                <span
                  key={slug}
                  className="text-[10px] font-bold tracking-wide"
                  style={{ color: r.color }}
                >
                  {r.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative size-[104px] shrink-0 overflow-hidden rounded-lg bg-muted">
        <ProductImage
          name={product.name}
          url={product.imageUrl}
          priority={priority}
          sizes="104px"
        />

        {product.promotion && (
          <span
            className="absolute left-1 top-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white shadow-sm"
            style={{ backgroundColor: product.promotion.color ?? 'var(--primary)' }}
          >
            {product.promotion.label}
          </span>
        )}

        {inCart > 0 && (
          <span
            className="absolute bottom-1 right-1 flex size-6 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground shadow"
            aria-label={`${inCart} no carrinho`}
          >
            {inCart}
          </span>
        )}
      </div>
    </button>
  );
}
