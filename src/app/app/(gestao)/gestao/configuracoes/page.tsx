import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { EditorDeConfiguracoes } from '@/components/gestao/editor-de-configuracoes';
import { exigirStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Configurações · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Configurações da casa (§8).
 *
 * O que o briefing perguntou UMA vez, na primeira entrada, mora aqui para
 * sempre. Sem esta tela, um restaurante que decidisse ligar o cashback três
 * meses depois não teria por onde — o sistema só aceitaria ser configurado no
 * dia em que nasceu.
 */
export default async function ConfiguracoesPage() {
  const staff = await exigirStaff();

  // O layout da gestão já cobra `dashboard.view`; esta tela cobra mais, e cobra
  // por conta própria — layout não protege rota filha por si só.
  if (!can(staff, 'restaurant.settings')) forbidden();

  const supabase = await createClient();
  const { data } = await supabase
    .from('restaurants')
    .select('name, service_fee_pct, cashback_pct, timezone, require_phone, brand_color')
    .eq('id', staff.restaurantId)
    .single();

  return (
    <EditorDeConfiguracoes
      nome={data?.name ?? ''}
      taxaServico={Number(data?.service_fee_pct ?? 10)}
      cashback={Number(data?.cashback_pct ?? 0)}
      timezone={data?.timezone ?? 'America/Sao_Paulo'}
      pedirTelefone={Boolean(data?.require_phone)}
      cor={data?.brand_color ?? '#D97A28'}
    />
  );
}
