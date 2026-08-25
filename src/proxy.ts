import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

/**
 * CSP com nonce (spec §10) e renovação da sessão.
 *
 * Renomeado de `middleware.ts` para `proxy.ts`: é a convenção do Next 16, e a
 * antiga já vinha avisando que está depreciada em todo `next dev`.
 *
 * ISTO NÃO É FRONTEIRA DE SEGURANÇA — já houve bypass de autenticação por
 * middleware no Next (CVE-2025-29927), e um header forjado bastava. A
 * autorização de verdade continua em `exigirStaff()`, nas policies de RLS e nas
 * funções do banco. O que este arquivo faz é honesto e limitado: renova token,
 * redireciona quem não está logado, e monta a CSP.
 */

/** URL do Supabase, para o `connect-src`. Sem ela o app não fala com o banco. */
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

function montarCsp(nonce: string, dev: boolean): string {
  // O Realtime é WebSocket: o mesmo host, outro esquema. Sem isto as telas da
  // equipe param de receber evento e sobem a faixa "sem conexão" — que estaria
  // dizendo a verdade, e pelo motivo errado.
  const websocket = SUPABASE.replace(/^http/, 'ws');

  return [
    `default-src 'self'`,

    // `strict-dynamic` faz o navegador confiar no que um script com nonce
    // carregar, e IGNORAR lista de domínios. É o que permite o Next carregar os
    // próprios chunks sem eu enumerar caminho por caminho.
    //
    // `unsafe-eval` só em desenvolvimento: o React usa `eval` para remontar o
    // stack de erro do servidor no navegador. Em produção nem React nem Next
    // usam, e deixar ligado seria abrir o buraco que a CSP existe para fechar.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,

    `style-src 'self' 'nonce-${nonce}'`,

    // Atributo `style=` inline é governado por `style-src-attr`, e sem esta
    // linha ele cai na regra acima e é BLOQUEADO. O app define a cor da marca
    // assim — `style={{ '--brand': ... }}` — em cada casca. Sem a exceção, todo
    // botão laranja do sistema fica sem cor, e nada no console explica por quê.
    //
    // A exceção é estreita de propósito: permite ATRIBUTO, não bloco `<style>`.
    // Injeção de estilo por atributo não executa código.
    `style-src-attr 'unsafe-inline'`,

    // `blob:` é o preview da foto no editor de cardápio, que mostra o arquivo
    // já comprimido antes de subir. `data:` cobre os placeholders.
    `img-src 'self' blob: data:`,
    `font-src 'self'`,

    // REST e Realtime do Supabase. É a única origem externa que o app precisa.
    `connect-src 'self' ${SUPABASE} ${websocket}`,

    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Redundante com o X-Frame-Options do next.config, e fica: navegador antigo
    // entende um, navegador novo entende o outro. Sem os dois, a tela do caixa
    // pode ser embutida num iframe e clicada por fora.
    `frame-ancestors 'none'`,
    ...(dev ? [] : [`upgrade-insecure-requests`]),
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  const dev = process.env.NODE_ENV === 'development';

  // Um nonce por REQUISIÇÃO. Reaproveitar entre requisições é o mesmo que não
  // ter nonce: previsível deixa de ser nonce.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = montarCsp(nonce, dev);

  const cabecalhos = new Headers(request.headers);
  cabecalhos.set('x-nonce', nonce);
  // O Next LÊ esta CSP da requisição para aplicar o nonce nos scripts dele.
  // Sem esta linha o cabeçalho de resposta existiria e o próprio Next seria
  // bloqueado pela CSP que ele mesmo recebeu.
  cabecalhos.set('Content-Security-Policy', csp);

  const caminho = request.nextUrl.pathname;

  // O cardápio do cliente NÃO passa por `updateSession`: não existe usuário
  // logado ali, e `auth.getUser()` seria uma ida ao servidor de auth em cada
  // abertura de cardápio — contra os 2s no 4G da §16. Mas PRECISA de CSP, e é
  // a superfície mais exposta do sistema: a única página que qualquer pessoa
  // na rua abre.
  //
  // Enquanto a CSP morava fora daqui, essa rota ficava sem nenhuma.
  if (caminho.startsWith('/m/') || caminho.startsWith('/api/mesa') ||
      caminho.startsWith('/api/pedidos') || caminho === '/privacidade') {
    const resposta = NextResponse.next({ request: { headers: cabecalhos } });
    resposta.headers.set('Content-Security-Policy', csp);
    return resposta;
  }

  const resposta = await updateSession(request, cabecalhos);
  resposta.headers.set('Content-Security-Policy', csp);
  return resposta;
}

export const config = {
  matcher: [
    /**
     * Tudo menos estáticos e imagens.
     *
     * O cardápio (`/m/*`) ENTRA agora — antes ficava de fora para poupar a ida
     * ao servidor de auth, e o efeito colateral era a página mais exposta do
     * sistema rodando sem CSP. A economia foi preservada dentro da função, que
     * pula o `updateSession` naquelas rotas.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|avif|gif|woff2)$).*)',
  ],
};
