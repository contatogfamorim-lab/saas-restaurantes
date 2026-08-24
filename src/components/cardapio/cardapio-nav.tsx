'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import type { DelegatablePermission } from '@/lib/permissions';

/**
 * Abas do editor.
 *
 * Aba que a pessoa não pode usar não aparece — mas isso é arrumação de tela, e
 * não segurança: cada página revalida a permissão, e o banco recusa a escrita
 * de qualquer jeito (spec §10.3, "esconder o botão não protege nada").
 *
 * Quem tem só `menu.availability` — a cozinha — vê uma aba só, e a tela inteira
 * vira a lista de ligar e desligar item. É o uso que acontece toda noite.
 */
export function CardapioNav({ permissoes }: { permissoes: DelegatablePermission[] }) {
  const caminho = usePathname();

  const tem = (p: DelegatablePermission) => permissoes.includes(p);

  const abas = [
    { href: '/app/cardapio', rotulo: 'Itens', visivel: true },
    {
      href: '/app/cardapio/categorias',
      rotulo: 'Categorias',
      visivel: tem('menu.structure'),
    },
  ].filter((a) => a.visivel);

  if (abas.length < 2) return null;

  return (
    <nav className="mx-auto flex max-w-5xl gap-1 px-3 pb-1.5">
      {abas.map((aba) => {
        const ativa =
          aba.href === '/app/cardapio' ? caminho === aba.href : caminho.startsWith(aba.href);

        return (
          <Link
            key={aba.href}
            href={aba.href}
            aria-current={ativa ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-[13px] font-semibold',
              ativa
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {aba.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
