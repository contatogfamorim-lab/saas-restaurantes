import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { PainelDeConfiguracao, type Passo } from '@/components/gestao/painel-de-configuracao';
import { exigirStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Configurações iniciais · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Configurações iniciais — o painel, e não o questionário.
 *
 * A versão anterior era um wizard: respondia-se uma vez, no primeiro minuto, e
 * nunca mais. Isso não corresponde ao que acontece. Ninguém configura um
 * restaurante inteiro numa sentada: a pessoa cria a conta, põe quatro pratos,
 * atende a noite, e volta no dia seguinte. Precisa saber onde parou.
 *
 * Cada linha responde a uma pergunta VERIFICÁVEL no banco — quantas mesas
 * existem, quantos produtos têm preço, se o WhatsApp está conectado. Nada de
 * caixinha para marcar: caixinha manual mente no primeiro esquecimento, e um
 * painel que mente é pior que painel nenhum.
 *
 * E cada linha diz ONDE resolver. Apontar o que falta sem dizer para onde ir
 * transfere o problema em vez de resolvê-lo.
 */
export default async function InicioPage() {
  const staff = await exigirStaff();
  if (!can(staff, 'restaurant.settings')) forbidden();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('progresso_da_configuracao');

  // Engolir o erro mostraria um painel vazio — que parece "tudo pronto".
  if (error) throw new Error(`progresso: ${error.message}`);

  const passos = (data as unknown as Passo[]) ?? [];

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Configurações iniciais"
        descricao="O que já está de pé e o que falta para a casa funcionar"
      />
      <PainelDeConfiguracao passos={passos} restaurante={staff.restaurantName} />
    </div>
  );
}
