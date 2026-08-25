import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Onboarding } from '@/components/onboarding/onboarding';
import { getStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Criar meu restaurante · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Onboarding (spec §14).
 *
 * Três passos, e o passo em que a pessoa está é decidido pelo ESTADO REAL, não
 * por um parâmetro na URL:
 *
 *   sem conta               → criar conta
 *   conta sem perfil        → criar restaurante
 *   sem briefing respondido → o briefing (obrigatório na primeira entrada)
 *   perfil sem mesa         → criar mesas
 *   tudo pronto             → sai daqui
 *
 * Ler o estado em vez de guardar um passo evita a tela que todo wizard tem: a
 * pessoa fecha o navegador no meio, volta, e o sistema pergunta de novo uma
 * coisa que ela já respondeu — ou pior, tenta criar de novo.
 *
 * O passo "criar mesas" ficou como EXCEÇÃO, não como caminho normal: o briefing
 * já pergunta quantas mesas e as cria. Ele sobra para restaurante que nasceu
 * antes do briefing existir e não tem mesa nenhuma.
 */
export default async function Comecar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <Onboarding passo="conta" />;

  const staff = await getStaff();
  if (!staff) return <Onboarding passo="restaurante" email={user.email ?? null} />;

  if (staff.briefingPendente) {
    return (
      <Onboarding
        passo="briefing"
        email={user.email ?? null}
        restaurante={staff.restaurantName}
      />
    );
  }

  const { count } = await supabase
    .from('restaurant_tables')
    .select('id', { count: 'exact', head: true });

  // Restaurante montado: não há onboarding a fazer. Mandar de volta para `/app`
  // em vez de mostrar um wizard vazio.
  if ((count ?? 0) > 0) redirect('/app');

  return (
    <Onboarding
      passo="mesas"
      email={user.email ?? null}
      restaurante={staff.restaurantName}
    />
  );
}
