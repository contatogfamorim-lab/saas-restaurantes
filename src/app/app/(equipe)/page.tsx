import { redirect } from 'next/navigation';

import { exigirStaff, telasVisiveis } from '@/lib/auth/staff';

/**
 * Porta de entrada da equipe: manda cada um para a sua tela.
 *
 * A ordem é a do trabalho, não a da hierarquia — quem acumula garçom e caixa
 * (spec P1b) cai no salão, que é onde a fila de aprovação vive e onde o tempo
 * de resposta importa.
 */
export default async function AppIndex() {
  const staff = await exigirStaff();
  const telas = telasVisiveis(staff);

  if (telas.salao) redirect('/app/salao');
  if (telas.cozinha) redirect('/app/cozinha');
  if (telas.caixa) redirect('/app/caixa');
  if (telas.gestao) redirect('/app/gestao');
  // Perdas vem por último: é o destino de quem só tem essa tela, o que hoje
  // não acontece (a cozinha tem KDS), mas acontecerá no dia em que alguém for
  // cadastrado só para conferir estoque. Sem esta linha, essa pessoa cairia
  // numa página que não sabe para onde mandá-la.
  if (telas.perdas) redirect('/app/perdas');

  // Perfil ativo sem nenhum papel útil: acontece se alguém for cadastrado e
  // ficar sem função. Melhor dizer isso do que mostrar uma tela vazia.
  return (
    <main className="px-5 py-10">
      <h1 className="font-display text-xl">Sem tela atribuída</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Seu usuário está ativo mas ainda não tem função. Peça ao dono para
        definir seu papel.
      </p>
    </main>
  );
}
