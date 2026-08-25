import type { Metadata } from 'next';

import { entrar } from './actions';

export const metadata: Metadata = {
  title: 'Entrar · Markello',
  robots: { index: false, follow: false },
};

/**
 * Login da equipe — usuário e senha, igual para todos os papéis.
 *
 * Depois de entrar, cada pessoa cai na tela da própria função e enxerga só
 * ela: garçom no salão, cozinha no KDS, caixa no caixa. Quem administra é a
 * única visão panorâmica.
 *
 * "Usuário" aceita o e-mail ou o código curto do crachá — quem está no tablet
 * digita `02`, não o endereço inteiro.
 */
export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; erro?: string }>;
}) {
  const { de, erro } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl leading-tight">Markello</h1>
      <p className="mt-1 text-sm text-muted-foreground">Acesso da equipe</p>

      <form action={entrar} className="mt-8">
        <input type="hidden" name="de" value={de ?? '/app'} />

        <label htmlFor="usuario" className="block text-sm font-medium">
          Usuário
        </label>
        <input
          id="usuario"
          name="usuario"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e-mail ou código"
          className="mt-1.5 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />

        <label htmlFor="senha" className="mt-4 block text-sm font-medium">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1.5 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />

        {erro && (
          <p role="alert" className="mt-4 text-[13px] text-destructive">
            {/* Mensagem única: distinguir "usuário não existe" de "senha errada"
                entrega a lista de quem trabalha aqui a quem estiver sondando. */}
            Usuário ou senha incorretos.
          </p>
        )}

        <button
          type="submit"
          className="mt-6 h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground"
        >
          Entrar
        </button>
      </form>

      {/* A porta de entrada de quem AINDA não tem conta. Ela existia desde a
          §14, em /comecar, e não era linkada de lugar nenhum — só chegava lá
          quem digitasse o endereço. */}
      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        Ainda não tem restaurante aqui?{' '}
        <a href="/comecar" className="font-semibold text-foreground underline">
          Criar o meu
        </a>
      </p>
    </main>
  );
}
