import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { KdsBoard } from '@/components/app/kds-board';
import { RealtimeStatus } from '@/components/app/realtime-status';
import { exigirStaff } from '@/lib/auth/staff';
import { TABELAS_POR_TELA } from '@/lib/realtime/canais';
import { carregarFila, type Estacao } from '@/lib/cozinha/queries';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Cozinha · Pedidos.IA',
  robots: { index: false, follow: false },
};

/** Fila de produção muda a cada segundo; cache aqui seria mentira. */
export const dynamic = 'force-dynamic';

/**
 * KDS — tela da cozinha (spec §6).
 *
 * A estação vem da URL (`?estacao=bar`) e não do perfil: o mesmo login é usado
 * no tablet da chapa e no do bar, e quem define qual é qual é o aparelho onde a
 * tela está pendurada. Cozinha não vê pedido do bar, e vice-versa.
 */
export default async function Cozinha({
  searchParams,
}: {
  searchParams: Promise<{ estacao?: string }>;
}) {
  const staff = await exigirStaff();

  if (!can(staff, 'kds.advance_item')) forbidden();

  const { estacao: bruta } = await searchParams;
  const estacao: Estacao = bruta === 'bar' ? 'bar' : 'cozinha';

  const fila = await carregarFila(estacao);

  return (
    <>
      {/* Cenário 2 da §9: garçom aprova, aparece na cozinha imediatamente. */}
      <RealtimeStatus
        restaurantId={staff.restaurantId}
        tabelas={TABELAS_POR_TELA.cozinha}
      />
      <KdsBoard
        fila={fila}
        estacao={estacao}
        podeRemoverDoCardapio={can(staff, 'menu.availability')}
      />
    </>
  );
}
