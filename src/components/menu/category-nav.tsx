'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import type { MenuCategory } from '@/lib/menu/types';

/**
 * Navegação horizontal fixa com scroll-spy (spec §4).
 *
 * O observer usa uma faixa estreita logo abaixo do cabeçalho em vez do
 * viewport inteiro. Com o viewport todo, duas categorias ficam visíveis ao
 * mesmo tempo e o chip ativo pisca entre elas enquanto a pessoa rola — o tipo
 * de detalhe que faz a navegação parecer quebrada sem ninguém saber dizer por
 * quê.
 */
interface Props {
  categories: MenuCategory[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
}

export function CategoryNav({ categories, activeId, onActiveChange }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // mantém o chip ativo visível conforme a pessoa rola o cardápio
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const chip = listRef.current.querySelector<HTMLElement>(`[data-chip="${activeId}"]`);
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  function jumpTo(id: string) {
    onActiveChange(id);
    document
      .getElementById(`categoria-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav
      aria-label="Categorias do cardápio"
      className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80"
    >
      <div
        ref={listRef}
        className="flex gap-1 overflow-x-auto px-2 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {categories.map((category) => {
          const isActive = category.id === activeId;
          return (
            <button
              key={category.id}
              type="button"
              data-chip={category.id}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => jumpTo(category.id)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground active:bg-accent',
              )}
            >
              {category.name}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Observa as seções e informa qual está no topo.
 *
 * Fica fora do componente de navegação porque quem conhece as seções é a tela
 * do cardápio — a navegação só desenha chips.
 */
export function useScrollSpy(
  ids: string[],
  onChange: (id: string) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || ids.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) onChange(visible.target.id.replace('categoria-', ''));
      },
      {
        // faixa de ~1/4 de tela logo abaixo da navegação fixa
        rootMargin: '-72px 0px -70% 0px',
        threshold: 0,
      },
    );

    for (const id of ids) {
      const el = document.getElementById(`categoria-${id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [ids, onChange, enabled]);
}
