'use client';

import { SearchIcon, XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DIET_LABELS, DIET_ORDER } from '@/lib/menu/labels';
import type { DietTag } from '@/lib/menu/types';

/**
 * Busca e filtros rápidos (spec §4).
 *
 * Os filtros dietéticos são combinados com E, não OU: quem marca "vegano" e
 * "sem glúten" tem restrição nas duas frentes e precisa do que atende às duas.
 * Tratar como OU devolveria pratos que a pessoa não pode comer — num filtro
 * de alergia, isso é sério.
 */
interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  activeDiets: DietTag[];
  onToggleDiet: (tag: DietTag) => void;
  onlyPromos: boolean;
  onToggleOnlyPromos: () => void;
  hasPromos: boolean;
}

export function FilterBar({
  query,
  onQueryChange,
  activeDiets,
  onToggleDiet,
  onlyPromos,
  onToggleOnlyPromos,
  hasPromos,
}: Props) {
  return (
    <div className="px-3 pb-1 pt-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar prato ou ingrediente"
          aria-label="Buscar no cardápio"
          className="h-11 w-full rounded-lg border border-input bg-transparent pl-9 pr-9 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Limpar busca"
            className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {hasPromos && (
          <FilterChip active={onlyPromos} onClick={onToggleOnlyPromos}>
            Só promoções
          </FilterChip>
        )}
        {DIET_ORDER.map((tag) => (
          <FilterChip
            key={tag}
            active={activeDiets.includes(tag)}
            onClick={() => onToggleDiet(tag)}
          >
            {DIET_LABELS[tag].long}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] transition-colors',
        active
          ? 'border-primary bg-primary/15 font-medium text-primary'
          : 'border-input text-muted-foreground active:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
