import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { lerAparelhoConfiavel } from '@/lib/auth/device';

import { entrar } from './actions';

export const metadata: Metadata = {
  title: 'Administrador · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Porta do Administrador.
 *
 * E-mail e senha aqui; o resto da equipe entra por código de operador e 5
 * dígitos, num aparelho que esta tela liberou.
 *
 * Aparelho já liberado cai direto no teclado do operador: o tablet da cozinha
 * não deve ver formulário de e-mail nunca mais. Quem administra chega pelo
 * `?admin=1`, que é o atalho consciente.
 */
export default async function PortaDoAdministrador({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; erro?: string; admin?: string }>;
}) {
  const { de, erro, admin } = await searchParams;

  if (!admin) {
    const aparelho = await lerAparelhoConfiavel();
    if (aparelho) redirect('/app/operador');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl leading-tight">Markello</h1>
      <p className="mt-1 text-sm text-muted-foreground">Acesso do Administrador</p>

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

        {/* Liberar o aparelho é ação DELIBERADA e privilégio de quem
            administra: transforma este tablet numa porta permanente da casa
            (spec §10.5). Marcado por padrão porque o caso comum é justamente
            configurar o aparelho da equipe. */}
        <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-lg bg-muted px-3 py-2.5">
          <input
            type="checkbox"
            name="liberarAparelho"
            defaultChecked
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="text-[13px] leading-snug">
            <span className="font-medium">Liberar este aparelho para a equipe</span>
            <span className="block text-muted-foreground">
              Depois disso, os operadores entram aqui só com código e 5 dígitos.
            </span>
          </span>
        </label>

        <label htmlFor="apelho" className="mt-3 block text-[13px] text-muted-foreground">
          Como chamar este aparelho
        </label>
        <input
          id="apelho"
          name="apelidoAparelho"
          type="text"
          maxLength={60}
          placeholder="Tablet da cozinha"
          className="mt-1 h-11 w-full rounded-lg border border-input bg-transparent px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />

        {erro && (
          <p role="alert" className="mt-4 text-[13px] text-destructive">
            {/* Mensagem única: distinguir "e-mail não existe" de "senha errada"
                entrega a lista de quem trabalha aqui a quem estiver sondando. */}
            E-mail ou senha incorretos.
          </p>
        )}

        <button
          type="submit"
          className="mt-5 h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
