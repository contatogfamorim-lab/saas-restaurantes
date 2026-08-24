import { Suspense } from 'react';
import Link from 'next/link';
import { forbidden, redirect } from 'next/navigation';
import { LogOutIcon } from 'lucide-react';

import { ConsoleNav } from '@/components/gestao/console-nav';
import { getStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';

import { sair } from '../../entrar/actions';

/**
 * Casca do console de gestão (spec §8).
 *
 * Layout PRÓPRIO, separado do `(equipe)`: as telas de operação são feitas para
 * um polegar em movimento — alvo grande, uma coisa por vez, navegação no topo.
 * Esta é feita para alguém sentado com a noite fechada, comparando sete números
 * de uma vez. Reaproveitar a casca do salão daria uma tela de celular esticada
 * num monitor de 27".
 *
 * Nenhuma das duas cascas aparece na navegação da outra: quem está no salão não
 * vê "Gestão", e quem está aqui volta pelo endereço.
 */
export default async function GestaoLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();

  // O middleware redireciona, mas não é fronteira de segurança
  // (CVE-2025-29927). Esta é a checagem que vale — e ela se repete em cada
  // página, porque layout não protege rota filha por si só.
  if (!staff) redirect('/app/entrar');
  if (!can(staff, 'dashboard.view')) forbidden();

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      <aside className="flex shrink-0 flex-col border-border bg-sidebar lg:h-dvh lg:w-56 lg:border-r">
        <div className="flex items-center justify-between gap-2 px-4 py-3 lg:block">
          <div>
            <p className="font-display text-[15px] leading-tight">{staff.restaurantName}</p>
            <p className="text-[11px] text-muted-foreground">Gestão · {staff.name}</p>
          </div>

          <form action={sair} className="lg:hidden">
            <button
              type="submit"
              aria-label="Sair"
              className="rounded-md p-2 text-muted-foreground hover:bg-secondary"
            >
              <LogOutIcon className="size-4" />
            </button>
          </form>
        </div>

        {/* `useSearchParams` obriga fronteira de Suspense no App Router. */}
        <Suspense fallback={<div className="h-12 lg:h-full" />}>
          <ConsoleNav />
        </Suspense>

        <div className="mt-auto hidden border-t border-border p-3 lg:block">
          <Link
            href="/app"
            className="block rounded-md px-3 py-2 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Telas de operação
          </Link>
          <form action={sair}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <LogOutIcon className="size-4" />
              Sair
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 lg:h-dvh lg:overflow-y-auto">{children}</main>
    </div>
  );
}
