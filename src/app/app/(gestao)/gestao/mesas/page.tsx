import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { FolhaDeMesas } from '@/components/gestao/folha-de-mesas';
import { exigirStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';
import { qrDaMesa } from '@/lib/mesas/qr';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Mesas · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Mesas e seus códigos (spec §14, §10).
 *
 * O `short_code` é o endereço da mesa, e é aleatório de dez caracteres — nunca
 * derivado do número. Um código sequencial deixaria qualquer pessoa adivinhar o
 * endereço da mesa vizinha e abrir comanda nela.
 *
 * A folha é feita para IMPRIMIR: uma mesa por bloco, com o QR grande e o código
 * escrito por extenso embaixo, porque o dia em que a câmera não lê alguém
 * digita.
 */
export default async function Mesas() {
  const staff = await exigirStaff();
  if (!can(staff, 'dashboard.view')) forbidden();

  const supabase = await createClient();
  const { data } = await supabase
    .from('restaurant_tables')
    .select('id, label, area, seats, short_code, active')
    .order('area')
    .order('label');

  // A URL vem do host da requisição, e não de uma variável de ambiente: o
  // mesmo código impresso precisa funcionar no domínio em que a pessoa está
  // acessando agora. Um `NEXT_PUBLIC_SITE_URL` errado em produção geraria mil
  // adesivos apontando para lugar nenhum, e o erro só apareceria na mesa.
  const cabecalhos = await headers();
  const host = cabecalhos.get('host') ?? 'localhost:3000';
  const protocolo = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const base = `${protocolo}://${host}`;

  const mesas = (data ?? []).map((m) => {
    const { svg, url } = qrDaMesa(base, m.short_code as string);
    return {
      id: m.id as string,
      label: m.label as string,
      area: (m.area as string) ?? '',
      lugares: (m.seats as number | null) ?? null,
      shortCode: m.short_code as string,
      ativa: Boolean(m.active),
      svg,
      url,
    };
  });

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Mesas"
        descricao={`${mesas.length} ${mesas.length === 1 ? 'mesa' : 'mesas'} · cada uma com o próprio código`}
      />
      <FolhaDeMesas mesas={mesas} restaurante={staff.restaurantName} />
    </div>
  );
}
