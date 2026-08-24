import Link from 'next/link';

/**
 * 403 do console de gestão.
 *
 * Precisa existir separado do 403 da área da equipe: grupos de rota são irmãos,
 * e um `forbidden.tsx` dentro de `(equipe)` não atende `(gestao)`. Sem este
 * arquivo o Next devolve a página padrão dele — em inglês, sem saída, e sem
 * parecer o produto.
 *
 * O texto NÃO diz quem pode entrar. "Peça a quem administra" em vez de "só o
 * administrador": enumerar os papéis que abrem a porta é informação de graça
 * para quem estiver testando limites por dentro, e a §10.8 lembra que em
 * restaurante o prejuízo quase sempre vem de dentro.
 */
export default function SemAcessoAGestao() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 text-center">
      <h1 className="font-display text-2xl leading-tight">Área da gestão</h1>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Seu acesso não cobre os números do restaurante. Se você deveria estar
        aqui, peça a quem administra a casa para ajustar sua função.
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
