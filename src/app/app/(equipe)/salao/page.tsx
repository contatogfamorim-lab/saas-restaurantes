import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { RealtimeStatus } from '@/components/app/realtime-status';
import { SalaoScreen } from '@/components/app/salao-screen';
import { exigirStaff } from '@/lib/auth/staff';
import { TABELAS_POR_TELA } from '@/lib/realtime/canais';
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
  if (!can(staff, 'order.approve')) forbidden();

  const { pedidos, mesas } = await carregarSalao();

  return (
    <>
      {/* Cenários 1 e 3 da §9: pedido novo do cliente e prato pronto na
          passagem precisam aparecer sem ninguém tocar na tela. */}
      <RealtimeStatus
        restaurantId={staff.restaurantId}
        tabelas={TABELAS_POR_TELA.salao}
      />
      <SalaoScreen
        pedidos={pedidos}
        mesas={mesas}
        podeMarcarEsgotado={can(staff, 'menu.availability')}
        podeForcarLiberacao={can(staff, 'table.force_release')}
      />
    </>
  );
}
