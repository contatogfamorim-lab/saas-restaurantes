import Link from 'next/link';
import { forbidden, redirect } from 'next/navigation';
import { ArrowLeftIcon } from 'lucide-react';

import { getStaff } from '@/lib/auth/staff';
import { canOpenMenuEditor, menuPermissions } from '@/lib/permissions';
import { CardapioNav } from '@/components/cardapio/cardapio-nav';

import { sair } from '../../entrar/actions';

/**
 * Casca do editor de cardápio (spec §12).
 *
 * CASCA PRÓPRIA, e não uma seção do console de gestão, por causa de quem entra:
 * o console exige `dashboard.view`, que é só do Administrador. Já
 * `menu.availability` é da cozinha e do garçom, e `menu.content` do gerente —
 * pendurar o editor dentro do console trancaria justamente quem usa a parte
 * dele que roda todo dia ("acabou o cheddar").
 *
 * Quem chega aqui tem ALGUMA permissão de cardápio. Qual delas decide o que
 * cada tela mostra — e o que o banco aceita, que é o que vale.
 */
export default async function CardapioLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();

  // O middleware redireciona, mas não é fronteira de segurança
  // (CVE-2025-29927). Esta é a checagem que vale — e cada página repete a sua,
  // porque layout não protege rota filha por si só.
  if (!staff) redirect('/app/entrar');
  if (!canOpenMenuEditor(staff)) forbidden();

  const permissoes = menuPermissions(staff);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link
            href="/app"
            aria-label="Voltar para as telas de operação"
            className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>

          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] leading-tight">Cardápio</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {staff.restaurantName} · {staff.name}
            </p>
          </div>

          <form action={sair}>
            <button
              type="submit"
              className="rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Sair
            </button>
          </form>
        </div>

        <CardapioNav permissoes={permissoes} />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">{children}</main>
    </div>
  );
}
