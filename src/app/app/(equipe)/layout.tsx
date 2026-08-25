import { exigirStaff, telasVisiveis } from '@/lib/auth/staff';
import { StaffNav } from '@/components/app/staff-nav';

/**
 * Casca das telas da equipe.
 *
 * A navegação é montada a partir dos PAPÉIS de quem entrou, e um funcionário
 * que acumula funções (spec P1b) vê as duas abas e alterna sem deslogar — que
 * é um dos critérios de aceite da §16.
 *
 * Esconder a aba é conveniência, não segurança: cada página revalida a
 * permissão por conta própria (spec §10.3).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
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

  const telas = telasVisiveis(staff);

  return (
    <div
      className="flex min-h-dvh flex-col bg-background"
      style={{ '--brand': staff.restaurantBrandColor } as React.CSSProperties}
    >
      <StaffNav
        telas={telas}
        nome={staff.name}
        restaurante={staff.restaurantName}
        papeis={staff.roles}
      />
      <div className="flex-1">{children}</div>
    </div>
  );
}
