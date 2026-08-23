/**
 * Fumaça de rotas: toda página responde, nenhuma entra em laço, nenhuma
 * renderiza erro.
 *
 *   pnpm dev            # noutro terminal
 *   pnpm check:routes
 *
 * Existe por causa de dois bugs reais que nenhum teste de banco pegaria e que
 * o `pnpm build` deixou passar:
 *
 *   1. a página de login vivia dentro do layout que exige login, e
 *      redirecionava para si mesma para sempre;
 *   2. uma constante exportada de um arquivo `'use server'` derrubava o módulo
 *      inteiro de ações na avaliação — e com ele o cabeçalho de TODAS as telas
 *      da equipe.
 *
 * Os dois só aparecem carregando a URL. O segundo só aparece carregando a URL
 * AUTENTICADO — por isso este script faz login de verdade, usando o próprio
 * @supabase/ssr com um cofre de cookies em memória, em vez de reconstruir à mão
 * o nome e o fatiamento do cookie de sessão.
 */
import { createServerClient } from '@supabase/ssr';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const MAX_SALTOS = 5;

const ADMIN_EMAIL = process.env.SMOKE_EMAIL ?? 'dono@brasaburger.test';
const ADMIN_SENHA = process.env.SMOKE_SENHA ?? 'senha-de-teste-123';

interface Caso {
  caminho: string;
  espera: 'pagina' | 'login';
  autenticado?: boolean;
  descricao: string;
}

const CASOS: Caso[] = [
  { caminho: '/app/entrar', espera: 'pagina', descricao: 'porta do Administrador abre' },
  // Sem aparelho liberado, a porta do operador MANDA para a do Administrador —
  // o teclado numérico nunca aparece para quem chega de fora (spec §10.5).
  { caminho: '/app/operador', espera: 'login', descricao: 'operador sem aparelho vai ao admin' },
  { caminho: '/app', espera: 'login', descricao: 'raiz da equipe exige login' },
  { caminho: '/app/salao', espera: 'login', descricao: 'salão exige login' },
  { caminho: '/privacidade', espera: 'pagina', descricao: 'aviso de dados é público' },

  // --- com sessão: é onde erro de avaliação de módulo aparece ---------------
  { caminho: '/app/salao', espera: 'pagina', autenticado: true, descricao: 'salão renderiza logado' },
];

/**
 * Faz login de verdade e devolve o cabeçalho Cookie resultante.
 *
 * O cofre em memória recebe exatamente o que a biblioteca escreveria no
 * browser — nome, fatiamento e codificação inclusos.
 */
async function cookiesDeSessao(): Promise<string> {
  const cofre = new Map<string, string>();

  const supabase = createServerClient(SUPABASE_URL, ANON, {
    cookies: {
      getAll: () => [...cofre].map(([name, value]) => ({ name, value })),
      setAll: (lista) => {
        for (const { name, value } of lista) cofre.set(name, value);
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_SENHA,
  });

  if (error) throw new Error(`login de fumaça falhou: ${error.message}`);

  return [...cofre].map(([n, v]) => `${n}=${v}`).join('; ');
}

/** Segue redirecionamentos à mão, para poder DETECTAR o laço em vez de sofrê-lo. */
async function seguir(caminho: string, cookie?: string) {
  const visitados: string[] = [];
  let url = new URL(caminho, BASE).toString();

  for (let i = 0; i <= MAX_SALTOS; i++) {
    const semQuery = new URL(url).pathname;
    if (visitados.includes(semQuery)) {
      return { laco: true, cadeia: [...visitados, semQuery], status: 0, url, corpo: '' };
    }
    visitados.push(semQuery);

    const res = await fetch(url, {
      redirect: 'manual',
      headers: cookie ? { cookie } : undefined,
    });

    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get('location');
      if (!destino) {
        return { laco: false, cadeia: visitados, status: res.status, url, corpo: '' };
      }
      url = new URL(destino, BASE).toString();
      continue;
    }

    return {
      laco: false,
      cadeia: visitados,
      status: res.status,
      url,
      corpo: await res.text().catch(() => ''),
    };
  }

  return { laco: true, cadeia: visitados, status: 0, url, corpo: '' };
}

/**
 * Erro que chega com status 200.
 *
 * Falha de avaliação de módulo em Server Component às vezes volta como página
 * renderizada com o erro embutido — HTTP 200, conteúdo quebrado. Olhar só o
 * código de status daria verde num erro real, que foi exatamente o que
 * aconteceu.
 */
const SINAIS_DE_ERRO = [
  'use server&quot; file can only export',
  'use server" file can only export',
  'Unhandled Runtime Error',
  'Internal Server Error',
  'call-stack-frame',
];

function corpoTemErro(corpo: string): string | null {
  return SINAIS_DE_ERRO.find((s) => corpo.includes(s)) ?? null;
}

async function main() {
  try {
    await fetch(BASE, { redirect: 'manual' });
  } catch {
    console.error(`✗ Nada respondendo em ${BASE}. Suba o servidor com \`pnpm dev\`.`);
    process.exit(1);
  }

  let cookie: string | undefined;
  try {
    cookie = await cookiesDeSessao();
  } catch (err) {
    console.error(`  ! sem sessão de teste: ${err instanceof Error ? err.message : err}`);
    console.error('    as rotas autenticadas serão PULADAS — não é aprovação\n');
  }

  let falhou = false;
  let pulados = 0;

  for (const caso of CASOS) {
    if (caso.autenticado && !cookie) {
      pulados += 1;
      continue;
    }

    const r = await seguir(caso.caminho, caso.autenticado ? cookie : undefined);

    if (r.laco) {
      console.error(
        `  ✗ ${caso.caminho.padEnd(16)} LAÇO DE REDIRECIONAMENTO: ${r.cadeia.join(' → ')}`,
      );
      falhou = true;
      continue;
    }

    const destino = new URL(r.url).pathname;
    const esperado = caso.espera === 'login' ? '/app/entrar' : caso.caminho;
    const erroNoCorpo = corpoTemErro(r.corpo);
    const ok = r.status === 200 && destino === esperado && !erroNoCorpo;

    const trava = caso.autenticado ? '🔒 ' : '   ';
    console[ok ? 'log' : 'error'](
      `  ${ok ? '✓' : '✗'} ${trava}${caso.caminho.padEnd(14)} ${r.status} → ${destino}` +
        `  (${caso.descricao})` +
        (erroNoCorpo ? `\n        ↳ ERRO RENDERIZADO NA PÁGINA: ${erroNoCorpo}` : ''),
    );

    if (!ok) falhou = true;
  }

  if (falhou) {
    console.error('\n✗ Alguma rota não responde como deveria.');
    process.exit(1);
  }

  if (pulados > 0) {
    console.error(`\n! ${pulados} rota(s) autenticada(s) não foram testadas.`);
    process.exit(1);
  }

  console.log('\n✓ rotas respondem, nenhuma em laço, nenhuma com erro renderizado.');
}

main().catch((err) => {
  console.error('✗ check-routes falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
