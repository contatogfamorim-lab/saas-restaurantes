import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { OperatorKeypad } from '@/components/app/operator-keypad';
import { lerAparelhoConfiavel } from '@/lib/auth/device';
import { createAdminClient } from '@/lib/supabase/admin';

export const metadata: Metadata = {
  title: 'Entrar · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Porta dos operadores.
 *
 * Só existe em aparelho liberado. Num aparelho qualquer da internet, esta rota
 * manda para o login do Administrador — o teclado numérico nunca chega a
 * aparecer, e é isso que impede alguém de varrer 100 mil combinações de fora
 * (spec §10.5).
 */
export default async function PortaDoOperador() {
  const aparelho = await lerAparelhoConfiavel();
  if (!aparelho) redirect('/app/entrar?admin=1');

  const admin = createAdminClient();
  const { data: restaurante } = await admin
    .from('restaurants')
    .select('name')
    .eq('id', aparelho.restaurantId)
    .maybeSingle();

  return <OperatorKeypad nomeDoRestaurante={restaurante?.name ?? 'Markello'} />;
}
