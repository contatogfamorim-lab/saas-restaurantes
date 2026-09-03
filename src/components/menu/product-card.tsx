'use client';

import { formatCents, discountPercent } from '@/lib/money';
import { servesLabel } from '@/lib/menu/labels';
import { Selo } from './selo';
import type { RestricaoDoCardapio, SeloDoCardapio } from '@/lib/menu/types';
import type { MenuProduct } from '@/lib/menu/types';

import { ProductImage } from './product-image';
import { Vitrine } from './palco/palco-3d';

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
 *
 * DOIS FORMATOS NA MESMA LISTA
 *
 * Prato com modelo 3D não cabe no quadrado de 104 px — ali ele vira um ponto
 * girando, e o efeito de ver a comida em volume, que é a razão de existir do
 * modelo, se perde inteiro. Então o card com modelo é LARGO: o prato ocupa a
 * faixa toda e o texto vem por cima, no rodapé.
 *
 * Prato sem modelo continua exatamente como sempre foi. Os dois formatos
 * convivem na mesma lista de propósito — a casa vai digitalizar os carro-chefe
 * primeiro e o resto ao longo de meses, e um cardápio que só funcionasse
 * "quando tudo estiver pronto" nunca entraria no ar. A alternância também
 * ajuda: o card largo lê como destaque no meio dos compactos.
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

  const selosEscolhidos = product.badges
    .map((slug) => selos.find((s) => s.slug === slug))
    .filter((s) => s !== undefined);

  const restricoesEscolhidas = product.dietTags
    .map((slug) => restricoes.find((r) => r.slug === slug))
    .filter((r) => r !== undefined);

  const preco = (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
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
  );

  const rodape = (product.dietTags.length > 0 || serves) && (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {serves && <span className="text-[11px] text-muted-foreground">{serves}</span>}
      {/* Restrição pintada, e não cinza como o resto da linha.
          Quem procura "sem glúten" varre a lista com o olho — cinza igual
          ao "Serve 2 pessoas" ao lado obriga a LER cada uma.
          Sem animação de propósito: aviso de alergia não é vitrine. */}
      {restricoesEscolhidas.map((r) => (
        <span
          key={r.slug}
          className="text-[10px] font-bold tracking-wide"
          style={{ color: r.color }}
        >
          {r.label}
        </span>
      ))}
    </div>
  );

  // Selo desconhecido some em silêncio: a casa pode ter desativado um selo que
  // ainda está em produtos antigos, e um retângulo vazio no card seria pior que
  // a ausência.
  const marcas = selosEscolhidos.length > 0 && (
    <div className="flex flex-wrap items-center gap-1.5">
      {selosEscolhidos.map((selo) => (
        <Selo key={selo.slug} selo={selo} />
      ))}
    </div>
  );

  const naSacola = inCart > 0 && (
    <span
      className="pointer-events-none absolute z-20 flex size-6 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground shadow"
      aria-label={`${inCart} no carrinho`}
      style={{ right: '0.5rem', bottom: '0.5rem' }}
    >
      {inCart}
    </span>
  );

  // ── CARD LARGO: o prato em 3D é o card ───────────────────────────────────
  if (product.modelo) {
    return (
      <button
        type="button"
        onClick={() => onOpen(product)}
        className="group relative block w-full overflow-hidden text-left"
      >
        {/* A vitrine é só a âncora: quem desenha é o canvas único do palco, que
            fica atrás deste elemento e recorta esta região. */}
        <Vitrine fonte={product.modelo.card} className="h-[230px] w-full" />

        {/* Gradiente para o texto não competir com o prato. Fica ACIMA do
            canvas (z-20) junto com o texto — o palco desenha em z-10. */}
        <div className="relative z-20 -mt-16 bg-linear-to-t from-background via-background/85 to-transparent px-4 pb-3 pt-10">
          {marcas}
          <h3 className="font-display mt-1 text-[21px] leading-tight text-foreground">
            {product.name}
          </h3>
          {product.description && (
            <p className="mt-1 line-clamp-1 text-[13px] leading-snug text-muted-foreground">
              {product.description}
            </p>
          )}
          <div className="mt-1.5">{preco}</div>
          {rodape}
        </div>

        {product.promotion && (
          <span
            className="absolute left-3 top-3 z-20 rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white shadow-sm"
            style={{ backgroundColor: product.promotion.color ?? 'var(--primary)' }}
          >
            {product.promotion.label}
          </span>
        )}
        {naSacola}
      </button>
    );
  }

  // ── CARD COMPACTO: o de sempre, para prato ainda sem modelo ───────────────
  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      className="group relative flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-accent/60 sm:gap-4"
    >
      <div className="min-w-0 flex-1 pt-0.5">
        {marcas}

        <h3 className="font-display mt-1 text-[19px] leading-tight text-foreground">
          {product.name}
        </h3>

        {product.description && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {product.description}
          </p>
        )}

        <div className="mt-2">{preco}</div>
        {rodape}
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
      </div>
      {naSacola}
    </button>
  );
}
