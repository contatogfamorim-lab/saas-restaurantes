import Link from 'next/link';

/**
 * 403 da área da equipe.
 *
 * Renderizada quando alguém autenticado alcança uma tela que a função dele não
 * cobre — cozinha abrindo o salão, garçom abrindo o caixa.
 *
 * Diz o que aconteceu sem detalhar QUEM pode: "peça a quem administra" em vez
 * de "só gerente e dono". Enumerar os papéis que abrem a porta é informação de
 * graça para quem estiver testando limites por dentro, e a spec §10.8 lembra
 * que em restaurante o prejuízo quase sempre vem de dentro.
 */
export default function SemPermissao() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-sm flex-col justify-center px-6 text-center">
      <h1 className="font-display text-2xl leading-tight">Esta tela não é sua</h1>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Seu acesso não cobre esta parte do sistema. Se você deveria estar aqui,
        peça a quem administra o restaurante para ajustar sua função.
      </p>

      <Link
        href="/app"
        className="mx-auto mt-6 flex h-12 items-center justify-center rounded-lg bg-foreground px-6 text-[15px] font-semibold text-background"
      >
        Voltar para a minha tela
      </Link>
    </main>
  );
}
