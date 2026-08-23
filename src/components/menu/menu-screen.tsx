'use client';

import { useState } from 'react';

import { brandStyle } from '@/lib/brand';
import { addLine, setLineQty } from '@/lib/menu/cart';
import { useCart } from '@/lib/menu/use-cart';
import type { DietTag, MenuData, MenuProduct } from '@/lib/menu/types';

import { CartBar } from './cart-bar';
import { CategoryNav, useScrollSpy } from './category-nav';
import { FilterBar } from './filter-bar';
import { MarkelloBadge } from './markello-badge';
import { ProductCard } from './product-card';
import { ProductSheet } from './product-sheet';
import { PromoRail } from './promo-rail';

/**
 * Tela do cardápio do cliente.
 *
 * Mantém carrinho, filtros e busca. NÃO abre conexão Realtime: o celular do
 * cliente custaria caro demais no orçamento de 500 conexões do plano Pro
 * (spec §9) — a partir da Etapa 3, o status dos itens vem por polling de 10s.
 */
interface Props {
  menu: MenuData;
  shortCode: string;
}

export function MenuScreen({ menu, shortCode }: Props) {
  const [query, setQuery] = useState('');
  const [diets, setDiets] = useState<DietTag[]>([]);
  const [onlyPromos, setOnlyPromos] = useState(false);
  const [selected, setSelected] = useState<MenuProduct | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(
    menu.categories[0]?.id ?? null,
  );

  // O carrinho sobrevive a fechar a aba sem querer — no meio do serviço isso
  // acontece o tempo todo, e remontar o pedido do zero é onde a pessoa desiste.
  const [lines, setLines] = useCart(`carrinho:${shortCode}`);

  const isFiltering = query.trim().length > 0 || diets.length > 0 || onlyPromos;

  const needle = query.trim().toLowerCase();
  const visibleCategories = menu.categories
    .map((category) => ({
      ...category,
      products: category.products.filter((product) => {
        if (onlyPromos && !product.promotion) return false;
        // filtros dietéticos combinam com E: quem marca vegano E sem glúten
        // tem as duas restrições, e devolver o que atende só uma seria grave
        if (!diets.every((tag) => product.dietTags.includes(tag))) return false;
        if (!needle) return true;
        // busca por nome E por ingrediente (spec §4) — a descrição é onde os
        // ingredientes moram
        return (
          product.name.toLowerCase().includes(needle) ||
          (product.description?.toLowerCase().includes(needle) ?? false)
        );
      }),
    }))
    .filter((category) => category.products.length > 0);

  const resultCount = visibleCategories.reduce((n, c) => n + c.products.length, 0);

  useScrollSpy(
    menu.categories.map((c) => c.id),
    setActiveCategory,
    !isFiltering,
  );

  function openProduct(product: MenuProduct) {
    setSelected(product);
    setSheetOpen(true);
  }

  function qtyInCart(productId: string) {
    return lines
      .filter((l) => l.productId === productId)
      .reduce((sum, l) => sum + l.qty, 0);
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg" style={brandStyle(menu.restaurant.brandColor)}>
      <header className="px-4 pt-5">
        <p className="text-[12px] uppercase tracking-wider text-muted-foreground">
          {menu.table.label} · {menu.table.area}
        </p>
        <h1 className="font-display mt-0.5 text-[26px] leading-tight">
          {menu.restaurant.name}
        </h1>
      </header>

      {!isFiltering && <PromoRail products={menu.promoted} onOpen={openProduct} />}

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        activeDiets={diets}
        onToggleDiet={(tag) =>
          setDiets((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
          )
        }
        onlyPromos={onlyPromos}
        onToggleOnlyPromos={() => setOnlyPromos((v) => !v)}
        hasPromos={menu.promoted.length > 0}
      />

      {!isFiltering && (
        <CategoryNav
          categories={menu.categories}
          activeId={activeCategory}
          onActiveChange={setActiveCategory}
        />
      )}

      {isFiltering && (
        <p aria-live="polite" className="px-4 pb-1 pt-2 text-[13px] text-muted-foreground">
          {resultCount === 0
            ? 'Nenhum item encontrado'
            : `${resultCount} ${resultCount === 1 ? 'item' : 'itens'}`}
        </p>
      )}

      <main>
        {visibleCategories.map((category, categoryIndex) => (
          <section
            key={category.id}
            id={`categoria-${category.id}`}
            aria-labelledby={`titulo-${category.id}`}
            className="scroll-mt-16 pt-5"
          >
            <h2
              id={`titulo-${category.id}`}
              className="font-display px-4 text-[15px] uppercase tracking-wide text-muted-foreground"
            >
              {category.name}
            </h2>

            <div className="mt-1 divide-y">
              {category.products.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onOpen={openProduct}
                  // só as duas primeiras da primeira seção entram como
                  // prioritárias; o resto é lazy (spec §13.2)
                  priority={categoryIndex === 0 && index < 2}
                  inCart={qtyInCart(product.id)}
                />
              ))}
            </div>
          </section>
        ))}

        {resultCount === 0 && isFiltering && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nada com esses filtros agora.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setDiets([]);
                setOnlyPromos(false);
              }}
              className="mt-3 text-sm font-medium text-primary underline underline-offset-4"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </main>

      <MarkelloBadge />

      <ProductSheet
        product={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onAdd={(line) => setLines((prev) => addLine(prev, line))}
      />

      <CartBar
        lines={lines}
        onChangeQty={(lineId, qty) => setLines((prev) => setLineQty(prev, lineId, qty))}
        onClear={() => setLines([])}
      />
    </div>
  );
}
