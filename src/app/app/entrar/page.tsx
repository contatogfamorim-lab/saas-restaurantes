import type { Metadata } from 'next';

import { entrar } from './actions';

export const metadata: Metadata = {
  title: 'Entrar · Markello',
  robots: { index: false, follow: false },
};

/**
 * Login da equipe.
 *
 * E-mail e senha na primeira vez do aparelho (spec P1). A troca rápida de
 * operador por PIN de 4 dígitos vem depois, e só vale em aparelho que já passou
 * por aqui — PIN não é credencial exposta à internet aberta (spec §10.5).
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

        <label htmlFor="email" className="block text-sm font-medium">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoCapitalize="none"
          className="mt-1.5 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
            {/* Mensagem única para credencial errada: distinguir "e-mail não
                existe" de "senha errada" entrega a lista de quem trabalha aqui
                a quem estiver sondando. */}
            E-mail ou senha incorretos.
          </p>
        )}

        <button
          type="submit"
          className="mt-6 h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
