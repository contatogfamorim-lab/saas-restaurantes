import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

/**
 * Renova o cookie de sessão do Supabase Auth a cada request.
 *
 * ATENÇÃO (spec §10.3): isto NÃO é fronteira de segurança. Já houve bypass de
 * autenticação por middleware no Next.js (CVE-2025-29927), e um header forjado
 * era suficiente para pular a checagem. O middleware aqui serve para duas
 * coisas honestas:
 *
 *   1. renovar o token antes de ele expirar no meio do serviço;
 *   2. redirecionar quem não está logado, para não cair numa tela vazia.
 *
 * A autorização de verdade acontece na camada de dados — em `requireStaff()`,
 * nas policies de RLS e nas funções do banco. Se alguém contornar este arquivo
 * inteiro, não ganha acesso a nada.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), não getSession(): só o primeiro valida o token no servidor de
  // auth. getSession() confia no que está no cookie, que é justamente o que
  // não se pode fazer.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const ehAreaDaEquipe = pathname.startsWith('/app');

  /**
   * DUAS portas, e as duas precisam ficar fora da checagem de sessão:
   *
   *   /app/entrar    Administrador, e-mail e senha
   *   /app/operador  código de operador + 5 dígitos, em aparelho liberado
   *
   * Esquecer `/app/operador` aqui recria um laço: o middleware mandaria para
   * `/app/entrar`, que devolveria para `/app/operador` ao ver o aparelho
   * liberado, para sempre.
   */
  const ehPorta = pathname === '/app/entrar' || pathname === '/app/operador';

  if (ehAreaDaEquipe && !ehPorta && !user) {
    const url = request.nextUrl.clone();
    // Sempre para /app/entrar: quem decide se o aparelho merece o teclado do
    // operador é aquela página, que pode consultar o banco. O middleware roda a
    // cada request e não tem orçamento para isso.
    url.pathname = '/app/entrar';
    url.searchParams.set('de', pathname);
    return NextResponse.redirect(url);
  }

  if (ehPorta && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
