import Link from 'next/link';

/**
 * 403 do editor de cardápio.
 *
 * Diferente do 403 da equipe de propósito. Lá a pessoa abriu a tela de outra
 * função e a resposta é "esta tela não é sua". Aqui ela já está no editor —
 * tem alguma permissão de cardápio — e esbarrou numa parte que exige outra.
 * Dizer "esta tela não é sua" seria confuso: metade dela é.
 *
 * Como no outro, não enumera QUEM pode. A §10.8 lembra que em restaurante o
 * prejuízo quase sempre vem de dentro, e uma lista de quem abre a porta é
 * informação de graça para quem estiver medindo limites por dentro.
 */
export default function SemPermissao() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-sm flex-col justify-center px-6 text-center">
      <h1 className="font-display text-2xl leading-tight">Área da gestão</h1>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Esta parte do cardápio precisa de uma permissão que seu acesso não cobre.
        Se você deveria mexer aqui, peça a quem administra o restaurante.
      </p>

      {/* Aponta para `/app`, que manda cada um para a própria tela. Apontar
          para `/app/cardapio` deixava a cozinha num botão que leva de volta
          para o mesmo 403 — ela não abre o editor por definição. */}
      <Link
        href="/app"
        className="mx-auto mt-6 flex h-12 items-center justify-center rounded-lg bg-foreground px-6 text-[15px] font-semibold text-background"
      >
        Voltar para a minha tela
      </Link>
    </main>
  );
}
