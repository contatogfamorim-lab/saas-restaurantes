import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { ArrowLeftIcon } from 'lucide-react';

import { exigirStaff } from '@/lib/auth/staff';
import { canOpenMenuEditor, menuPermissions } from '@/lib/permissions';
import { CardapioNav } from '@/components/cardapio/cardapio-nav';

import { sair } from '../../entrar/actions';

/**
 * Casca do editor de cardápio (spec §12).
 *
 * FERRAMENTA DE QUEM ADMINISTRA, e não uma tela de serviço. A diferença é
 * concreta: aqui alguém está sentado decidindo o que a casa vende e por quanto,
 * com tempo para olhar o preview antes de publicar. As telas de `(equipe)` são
 * o oposto — de pé, no meio do movimento, uma decisão por vez.
 *
 * `menu.availability` NÃO abre esta porta. A cozinha marca esgotado em
 * `/app/disponibilidade` e no próprio KDS; trazê-la para cá dava um editor com
 * todos os campos cadeados, que é uma tela cujo único uso é descobrir que você
 * não pode.
 *
 * Continua sendo PERMISSÃO e não papel: o administrador delega `menu.price` a
 * alguém e essa pessoa entra (spec §12.9).
 */
export default async function CardapioLayout({ children }: { children: React.ReactNode }) {
  // `exigirStaff()` e NÃO `getStaff()` + redirect próprio.
  //
  // A regra de para onde mandar quem não tem staff é sutil demais para viver em
  // cópia: quem está logado e sem perfil precisa ir para `/comecar`, e mandá-lo
  // para a porta faz o `proxy.ts` devolvê-lo para `/app` — laço infinito, tela
  // preta, nenhum erro. Este layout tinha a própria cópia da regra e era ELE
  // quem disparava o laço, antes mesmo de a página rodar.
  //
  // A checagem continua valendo o que valia: o middleware não é fronteira
  // (CVE-2025-29927), e esta é a que conta.
  const staff = await exigirStaff();
  if (!canOpenMenuEditor(staff)) forbidden();

  const permissoes = menuPermissions(staff);

  return (
    <div
      className="flex min-h-dvh flex-col bg-background"
      style={{ '--brand': staff.restaurantBrandColor } as React.CSSProperties}
    >
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-360 items-center gap-3 px-5 py-2.5">
          <Link
            href="/app"
            aria-label="Voltar para as telas de operação"
            className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>

          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] leading-tight">
              Editor de cardápio
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {staff.restaurantName} · {staff.name}
            </p>
          </div>

          <Link
            href="/app/gestao/cardapio"
            className="hidden rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground sm:block"
          >
            Ver desempenho
          </Link>

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

      <main className="mx-auto w-full max-w-360 flex-1 px-5 py-4">{children}</main>
    </div>
  );
}
