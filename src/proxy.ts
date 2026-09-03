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

/**
 * AS ROTAS QUE O BUILD MATERIALIZA EM HTML, E POR ISSO NÃO PODEM TER NONCE.
 *
 * O nonce é aplicado pelo Next durante a renderização, lendo o cabeçalho da
 * REQUISIÇÃO. Página pré-renderizada é gerada no build, quando requisição não
 * existe — então o HTML sai sem nenhum `nonce=`, e a CSP que este arquivo manda
 * junto bloqueia todo script da página. Não é sutileza: com `strict-dynamic` o
 * `'self'` é ignorado, então caem os 26 scripts inline E os 9 arquivos de
 * chunk. A página inteira fica sem JavaScript, e o console enche de violação.
 *
 * Foi assim que a landing quebrou quando virou estática, e a `/privacidade`
 * estava quebrada desde que nasceu, pelo mesmo motivo e sem ninguém notar.
 *
 * A saída não é abrir mão da estática — página de venda não pode depender de
 * render por requisição — e sim reconhecer o que o nonce compra em cada rota.
 * Nonce serve para separar "script que eu escrevi" de "script que injetaram".
 * Nestas duas rotas não existe o segundo caso: o HTML é artefato de build,
 * idêntico byte a byte para todo visitante, derivado só do código-fonte. Não há
 * parâmetro, não há banco, não há conteúdo de usuário. Quem consegue injetar
 * script aqui já escreve no repositório, e aí CSP não é a defesa que falhou.
 *
 * O QUE ISSO CUSTA, EM VOZ ALTA: nestas rotas `'unsafe-inline'` também libera
 * `onclick=` e `javascript:`. É aceitável porque nada dinâmico é renderizado
 * nelas — e deixa de ser no instante em que uma delas passar a ler `searchParams`
 * ou o banco. Se isso acontecer, ou a rota sai desta lista, ou volta a ser
 * dinâmica.
 *
 * MANTER EM DIA COM O BUILD. `find .next/server/app -name '*.html'` lista o que
 * é pré-renderizado de verdade; o teste em `verificar-csp` falha se divergir.
 */
const PRE_RENDERIZADAS: ReadonlySet<string> = new Set(['/', '/privacidade']);

function montarCsp(nonce: string | null, dev: boolean): string {
  // O Realtime é WebSocket: o mesmo host, outro esquema. Sem isto as telas da
  // equipe param de receber evento e sobem a faixa "sem conexão" — que estaria
  // dizendo a verdade, e pelo motivo errado.
  const websocket = SUPABASE.replace(/^http/, 'ws');

  // `unsafe-eval` só em desenvolvimento: o React usa `eval` para remontar o
  // stack de erro do servidor no navegador. Em produção nem React nem Next
  // usam, e deixar ligado seria abrir o buraco que a CSP existe para fechar.
  const eval_ = dev ? " 'unsafe-eval'" : '';

  // WASM PARA O DECODIFICADOR DRACO DO CARDÁPIO 3D.
  //
  // Compilar WebAssembly é governado pelo `script-src`, e sob uma CSP sem
  // `unsafe-eval` a chamada falha. É o que aconteceria com todo modelo de prato
  // comprimido — sem erro visível, só o card sem o 3D.
  //
  // `wasm-unsafe-eval` é MUITO mais estreito que `unsafe-eval`: libera compilar
  // WebAssembly e nada mais. Não devolve `eval()`, não devolve `new Function()`,
  // não afeta JavaScript. O que ele amplia é a superfície de "código que veio de
  // um buffer" — e o buffer aqui é `/draco/draco_decoder.wasm`, servido pela
  // própria origem, com `default-src 'self'` barrando qualquer outra.
  //
  // Vale a pena? A alternativa é servir os modelos SEM compressão, e a medição
  // é dura: o hambúrguer de 71 mil triângulos sai de 1.663 KB para 105 KB. Sem
  // Draco não existe cardápio 3D dentro de um orçamento de rede honesto.
  const wasm = " 'wasm-unsafe-eval'";

  // `strict-dynamic` faz o navegador confiar no que um script com nonce
  // carregar, e IGNORAR lista de domínios. É o que permite o Next carregar os
  // próprios chunks sem eu enumerar caminho por caminho. Ele só funciona COM
  // nonce — sem um, ele passa a ser exatamente o que bloqueia a página.
  const script = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${eval_}${wasm}`
    : `script-src 'self' 'unsafe-inline'${eval_}${wasm}`;

  // `style-src` não precisa da exceção nem nas rotas estáticas: o CSS sai em
  // folha externa, que `'self'` cobre. Verificado — zero `<style>` no HTML.
  return [
    `default-src 'self'`,
    script,
    nonce ? `style-src 'self' 'nonce-${nonce}'` : `style-src 'self'`,

    // Atributo `style=` inline é governado por `style-src-attr`, e sem esta
    // linha ele cai na regra acima e é BLOQUEADO. O app define a cor da marca
    // assim — `style={{ '--brand': ... }}` — em cada casca, e o herói da landing
    // carrega as três variáveis de cada célula do mesmo jeito. Sem a exceção,
    // todo botão laranja do sistema fica sem cor e a animação não sai do lugar,
    // sem nada no console explicando por quê.
    //
    // A exceção é estreita de propósito: permite ATRIBUTO, não bloco `<style>`.
    // Injeção de estilo por atributo não executa código.
    `style-src-attr 'unsafe-inline'`,

    // `blob:` é o preview da foto no editor de cardápio, que mostra o arquivo
    // já comprimido antes de subir. `data:` cobre os placeholders.
    `img-src 'self' blob: data:`,
    `font-src 'self'`,

    // REST e Realtime do Supabase, mais `blob:` para o cardápio 3D.
    //
    // O `blob:` não é firula. O `GLTFLoader` extrai as texturas embutidas no
    // GLB para URLs de blob e as carrega com `fetch` — que é governado por
    // `connect-src`, não por `img-src`. Sem esta permissão o modelo carrega, a
    // geometria aparece, e a TEXTURA some: o material cai para o padrão do
    // glTF (branco, metálico) e o prato vira uma escultura de gesso.
    //
    // Custou horas achar. O erro real está no console — "Couldn't load texture
    // blob:" — mas o sintoma parece defeito do arquivo, e passei um bom tempo
    // dissecando o GLB, que estava correto o tempo todo. Só apareceu quando o
    // primeiro modelo COM textura chegou; os procedurais são cor sólida.
    //
    // Blob é conteúdo que a própria página criou, a partir de bytes que já
    // baixou pela origem permitida. Não abre superfície nova.
    `connect-src 'self' blob: ${SUPABASE} ${websocket}`,

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

/**
 * Permissions-Policy, que passou a depender da rota.
 *
 * O padrão continua sendo o mais fechado possível: nada de câmera, microfone,
 * localização ou pagamento em lugar nenhum. A tela da cozinha e o caixa não têm
 * o que fazer com uma câmera, e um XSS que conseguisse abrir uma no salão seria
 * um problema de outra ordem.
 *
 * A exceção é o cardápio do cliente, onde o AR mostra o prato em tamanho real
 * sobre a mesa. Ele precisa de duas coisas:
 *
 *   camera               — o vídeo por trás do modelo
 *   xr-spatial-tracking  — a posição e a orientação do aparelho no espaço
 *
 * As duas são `(self)`: valem para a nossa origem e não são delegadas a iframe
 * nenhum. E valem SÓ nas rotas que exibem cardápio — a exceção é do tamanho do
 * recurso, não do app.
 *
 * No iPhone o AR não passa por aqui: o Quick Look é um visualizador do sistema,
 * fora da página, e não consulta esta política. Ela governa o caminho WebXR,
 * que hoje é o do Android.
 */
function montarPermissoes(caminho: string): string {
  const comAr = caminho.startsWith('/m/') || caminho.startsWith('/laboratorio/');

  return [
    comAr ? 'camera=(self)' : 'camera=()',
    comAr ? 'xr-spatial-tracking=(self)' : 'xr-spatial-tracking=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
  ].join(', ');
}

export async function proxy(request: NextRequest) {
  const dev = process.env.NODE_ENV === 'development';
  const caminho = request.nextUrl.pathname;

  // Um nonce por REQUISIÇÃO. Reaproveitar entre requisições é o mesmo que não
  // ter nonce: previsível deixa de ser nonce.
  const nonce = PRE_RENDERIZADAS.has(caminho)
    ? null
    : Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = montarCsp(nonce, dev);
  const permissoes = montarPermissoes(caminho);

  const cabecalhos = new Headers(request.headers);
  // O Next LÊ esta CSP da requisição para aplicar o nonce nos scripts dele.
  // Sem esta linha o cabeçalho de resposta existiria e o próprio Next seria
  // bloqueado pela CSP que ele mesmo recebeu.
  cabecalhos.set('Content-Security-Policy', csp);
  if (nonce) cabecalhos.set('x-nonce', nonce);
  // Requisição sem nonce não pode carregar um `x-nonce` herdado de fora: seria
  // um valor escolhido pelo cliente entrando no HTML como se fosse nosso.
  else cabecalhos.delete('x-nonce');

  // Rotas públicas NÃO passam por `updateSession`: não existe usuário logado
  // ali, e `auth.getUser()` seria uma ida ao servidor de auth em cada abertura
  // — contra os 2s no 4G da §16. O cardápio é a superfície mais exposta do
  // sistema, a única página que qualquer pessoa na rua abre; a landing é a mais
  // visitada. Nenhuma das duas lê sessão para renderizar.
  //
  // Enquanto a CSP morava fora daqui, essas rotas ficavam sem nenhuma.
  const publica =
    caminho === '/' ||
    caminho === '/privacidade' ||
    caminho.startsWith('/m/') ||
    caminho.startsWith('/api/mesa') ||
    caminho.startsWith('/api/pedidos');

  if (publica) {
    const resposta = NextResponse.next({ request: { headers: cabecalhos } });
    resposta.headers.set('Content-Security-Policy', csp);
    resposta.headers.set('Permissions-Policy', permissoes);
    return resposta;
  }

  const resposta = await updateSession(request, cabecalhos);
  resposta.headers.set('Content-Security-Policy', csp);
  resposta.headers.set('Permissions-Policy', permissoes);
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
