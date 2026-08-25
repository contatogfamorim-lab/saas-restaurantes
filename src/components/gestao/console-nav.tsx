'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  BanknoteIcon,
  ClipboardListIcon,
  FlameIcon,
  QrCodeIcon,
  ScrollTextIcon,
  TagIcon,
  UsersIcon,
  UtensilsCrossedIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Barra lateral do console (spec §8).
 *
 * Layout de ferramenta, não de aplicativo de salão. As telas da equipe são
 * feitas para um polegar em movimento, com alvo de 44px e uma coisa por vez;
 * esta é feita para alguém sentado, com mouse e a noite fechada — densidade
 * alta, muita informação simultânea, tudo comparável de relance.
 *
 * A lateral é fixa e sempre visível: no celular ela vira uma tira rolável no
 * topo, porque o dono às vezes confere o faturamento no ônibus, mas a tela de
 * verdade é a de 1440px.
 */
const SECOES = [
  { href: '/app/gestao', rotulo: 'Vendas', icone: BanknoteIcon },
  { href: '/app/gestao/operacao', rotulo: 'Operação', icone: FlameIcon },
  { href: '/app/gestao/cardapio', rotulo: 'Cardápio', icone: UtensilsCrossedIcon },
  { href: '/app/gestao/promocoes', rotulo: 'Promoções', icone: TagIcon },
  { href: '/app/gestao/mesas', rotulo: 'Mesas', icone: QrCodeIcon },
  { href: '/app/gestao/equipe', rotulo: 'Equipe', icone: UsersIcon },
  { href: '/app/gestao/clientes', rotulo: 'Clientes', icone: ClipboardListIcon },
  { href: '/app/gestao/auditoria', rotulo: 'Auditoria', icone: ScrollTextIcon },
] as const;

export function ConsoleNav() {
  const caminho = usePathname();
  const params = useSearchParams();

  // O período escolhido acompanha a navegação. Trocar de seção e perder o
  // recorte de 90 dias obrigaria a reescolher a cada clique.
  const periodo = params.get('periodo');
  const sufixo = periodo ? `?periodo=${periodo}` : '';

  return (
    <nav
      aria-label="Seções da gestão"
      className="flex gap-1 overflow-x-auto border-b border-border p-2 lg:h-full lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:p-3"
    >
      {SECOES.map(({ href, rotulo, icone: Icone }) => {
        // `/app/gestao` casaria com tudo em `startsWith`; a raiz é exata.
        const ativo = href === '/app/gestao' ? caminho === href : caminho.startsWith(href);

        return (
          <Link
            key={href}
            href={`${href}${sufixo}`}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
              ativo
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            <Icone className="size-4 shrink-0" />
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
