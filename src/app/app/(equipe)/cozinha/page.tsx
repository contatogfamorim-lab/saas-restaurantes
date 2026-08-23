import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { KdsBoard } from '@/components/app/kds-board';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarFila, type Estacao } from '@/lib/cozinha/queries';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Cozinha · Markello',
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
    <KdsBoard
      fila={fila}
      estacao={estacao}
      podeRemoverDoCardapio={can(staff, 'menu.availability')}
    />
  );
}
