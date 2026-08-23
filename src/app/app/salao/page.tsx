import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { AutoRefresh } from '@/components/app/auto-refresh';
import { SalaoScreen } from '@/components/app/salao-screen';
import { exigirStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';
import { carregarSalao } from '@/lib/salao/queries';

export const metadata: Metadata = {
  title: 'Salão · Markello',
  robots: { index: false, follow: false },
};

/** Estado de salão muda a cada segundo; cache aqui seria mentira. */
export const dynamic = 'force-dynamic';

export default async function Salao() {
  const staff = await exigirStaff();

  // O middleware redireciona quem não está logado, mas quem pode ver ESTA tela
  // é decidido aqui — middleware não é fronteira de segurança (spec §10.3).
  if (!can(staff, 'order.approve') && !can(staff, 'table.release')) {
    forbidden();
  }

  const { pedidos, mesas } = await carregarSalao();

  return (
    <>
      <AutoRefresh segundos={8} />
      <SalaoScreen
        pedidos={pedidos}
        mesas={mesas}
        podeMarcarEsgotado={can(staff, 'menu.availability')}
        podeForcarLiberacao={can(staff, 'table.force_release')}
      />
    </>
  );
}
