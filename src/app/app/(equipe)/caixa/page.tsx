import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { CaixaScreen } from '@/components/app/caixa-screen';
import { exigirStaff } from '@/lib/auth/staff';
import { listarComandas } from '@/lib/caixa/queries';
import { DISCOUNT_CEILING_PCT, can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Caixa · Markello',
  robots: { index: false, follow: false },
};

/** Saldo de comanda muda a cada pagamento; cache aqui seria mentira. */
export const dynamic = 'force-dynamic';

export default async function Caixa() {
  const staff = await exigirStaff();

  if (!can(staff, 'payment.record')) forbidden();

  const comandas = await listarComandas();

  // O teto de desconto é do MAIOR papel que a pessoa acumula: quem é caixa e
  // gerente ao mesmo tempo usa o limite de gerente (spec P1b).
  const teto = staff.roles.reduce(
    (max, papel) => Math.max(max, DISCOUNT_CEILING_PCT[papel] ?? 0),
    0,
  );

  return (
    <CaixaScreen
      comandas={comandas}
      podeForcar={can(staff, 'table.force_release')}
      tetoDesconto={teto}
    />
  );
}
