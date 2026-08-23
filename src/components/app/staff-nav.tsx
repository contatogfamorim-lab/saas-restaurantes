'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOutIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { sair } from '@/app/app/entrar/actions';
import type { Role } from '@/lib/permissions';

const ROTULO_PAPEL: Record<Role, string> = {
  owner: 'dono',
  manager: 'gerente',
  waiter: 'garçom',
  kitchen: 'cozinha',
  cashier: 'caixa',
};

/**
 * Navegação da equipe.
 *
 * Quem acumula funções vê as duas abas e troca com um toque, sem deslogar
 * (spec P1b e critério da §16). Nada de animação: no meio do serviço, cada
 * transição é tempo que o garçom fica olhando para a tela em vez do salão.
 */
interface Props {
  telas: { salao: boolean; cozinha: boolean; caixa: boolean; gestao: boolean };
  nome: string;
  restaurante: string;
  papeis: Role[];
}

export function StaffNav({ telas, nome, restaurante, papeis }: Props) {
  const pathname = usePathname();

  const abas = [
    { href: '/app/salao', rotulo: 'Salão', visivel: telas.salao },
    { href: '/app/cozinha', rotulo: 'Cozinha', visivel: telas.cozinha },
    { href: '/app/caixa', rotulo: 'Caixa', visivel: telas.caixa },
    // Gestão não aparece na navegação das outras telas (spec §8) — só para
    // quem tem a permissão, que é exclusiva do dono.
    { href: '/app/gestao', rotulo: 'Gestão', visivel: telas.gestao },
  ].filter((a) => a.visivel);

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight">{nome}</p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            {restaurante} · {papeis.map((p) => ROTULO_PAPEL[p]).join(' + ')}
          </p>
        </div>

        <form action={sair}>
          <button
            type="submit"
            aria-label="Sair"
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          >
            <LogOutIcon className="size-4" />
          </button>
        </form>
      </div>

      {abas.length > 1 && (
        <nav className="flex gap-1 px-2 pb-2">
          {abas.map((aba) => {
            const ativo = pathname.startsWith(aba.href);
            return (
              <Link
                key={aba.href}
                href={aba.href}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'flex-1 rounded-md px-3 py-2 text-center text-[14px] font-semibold',
                  ativo
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {aba.rotulo}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
