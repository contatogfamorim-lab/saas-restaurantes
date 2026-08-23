import { redirect } from 'next/navigation';

import { getStaff, telasVisiveis } from '@/lib/auth/staff';
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
  const staff = await getStaff();

  // O middleware já redireciona, mas ele não é fronteira de segurança
  // (CVE-2025-29927). Esta é a checagem que vale.
  if (!staff) redirect('/app/entrar');

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
