/**
 * A CSP existe, cobre as superfícies, e CASA COM O MODO DE RENDERIZAÇÃO.
 *
 * O erro que este script existe para pegar não é "falta CSP" — é CSP que PARECE
 * estar lá e não protege: `unsafe-inline` no `script-src` anula o nonce inteiro,
 * `unsafe-eval` deixado ligado em produção reabre o buraco, e nonce repetido
 * entre requisições deixa de ser nonce.
 *
 * ── A VERIFICAÇÃO QUE FALTAVA, E O DEFEITO QUE ELA DEIXOU PASSAR ───────────
 *
 * A versão anterior lia só o CABEÇALHO. E o cabeçalho estava impecável nas duas
 * páginas estáticas do sistema — nonce presente, sem `unsafe-*`, tudo verde —
 * enquanto na página os 26 scripts inline e os 9 chunks estavam TODOS
 * bloqueados. O nonce é aplicado durante a renderização, lendo o cabeçalho da
 * requisição; página pré-renderizada nasce no build, quando requisição não
 * existe, e sai sem nenhum `nonce=` no HTML. Com `strict-dynamic` o `'self'` é
 * ignorado, então nem os arquivos externos escapam.
 *
 * A landing quebrou assim no dia em que virou estática. A `/privacidade` estava
 * quebrada desde que nasceu, e nada acusou.
 *
 * Então o que se verifica aqui é o CASAMENTO, não a presença:
 *
 *   rota dinâmica        → nonce no cabeçalho E no HTML, e os dois IGUAIS
 *   rota pré-renderizada → sem nonce dos dois lados, e `'self'` cobrindo o resto
 *
 * E a lista de rotas estáticas do `proxy.ts` é conferida contra o que o build
 * realmente materializou em disco — senão a próxima página estática entra em
 * produção com a política errada, do mesmo jeito silencioso.
 *
 *     npm run build && npm start &
 *     npm run check:csp
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const falhas: string[] = [];

interface Resposta {
  status: number;
  csp: string;
  html: string;
}

async function buscar(caminho: string): Promise<Resposta> {
  const r = await fetch(`${BASE}${caminho}`, { redirect: 'manual' });
  return {
    status: r.status,
    csp: r.headers.get('content-security-policy') ?? '',
    html: await r.text(),
  };
}

const nonceDoCabecalho = (csp: string) => csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1] ?? null;
const nonceDoCorpo = (html: string) => html.match(/nonce="([^"]+)"/)?.[1] ?? null;

/* ── 1. o que o BUILD materializou em HTML ────────────────────────────────── */

function preRenderizadasNoDisco(): Set<string> {
  const raiz = '.next/server/app';
  const achadas = new Set<string>();
  const andar = (dir: string, prefixo: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) andar(join(dir, e.name), `${prefixo}/${e.name}`);
      else if (e.name.endsWith('.html')) {
        const base = e.name.slice(0, -5);
        // `_not-found` e `_global-error` não são endereços: são as telas de
        // fallback. Quem responde por um caminho errado é `[...nao-encontrado]`,
        // que é dinâmica de propósito.
        if (base.startsWith('_')) continue;
        achadas.add(base === 'index' ? prefixo || '/' : `${prefixo}/${base}`);
      }
    }
  };
  andar(raiz, '');
  return achadas;
}

function preRenderizadasNoProxy(): Set<string> {
  const fonte = readFileSync('src/proxy.ts', 'utf8');
  const bloco = fonte.match(/PRE_RENDERIZADAS[^=]*=\s*new Set\(\[([^\]]*)\]\)/)?.[1];
  if (bloco === undefined) throw new Error('não achei PRE_RENDERIZADAS em src/proxy.ts');
  return new Set([...bloco.matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

const noDisco = preRenderizadasNoDisco();
const noProxy = preRenderizadasNoProxy();

for (const r of noDisco) {
  if (!noProxy.has(r)) {
    falhas.push(
      `${r} é pré-renderizada mas não está em PRE_RENDERIZADAS — vai receber ` +
        `CSP com nonce e ter TODO script bloqueado, sem erro no servidor`,
    );
  }
}
for (const r of noProxy) {
  if (!noDisco.has(r)) {
    falhas.push(
      `${r} está em PRE_RENDERIZADAS mas o build a renderiza por requisição — ` +
        `está recebendo política fraca sem precisar`,
    );
  }
}
if (noDisco.size > 0 && noProxy.size > 0 && falhas.length === 0) {
  console.log(`  ✓ lista do proxy bate com o build: ${[...noDisco].sort().join(', ')}`);
}

/* ── 2. cada superfície, com o casamento cabeçalho↔HTML ───────────────────── */

/** O cardápio precisa de um short_code real; pega um do próprio sistema. */
async function umCardapio(): Promise<string | null> {
  const { Client } = await import('pg');
  const c = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await c.connect();
  try {
    const { rows } = await c.query(
      `select short_code from public.restaurant_tables where active limit 1`,
    );
    return rows[0]?.short_code ? `/m/${rows[0].short_code}` : null;
  } finally {
    await c.end();
  }
}

interface Superficie {
  nome: string;
  caminho: string;
  estatica: boolean;
  status?: number;
}

const superficies: Superficie[] = [
  { nome: 'tela da equipe', caminho: '/app/entrar', estatica: false },
  { nome: 'onboarding', caminho: '/comecar', estatica: false },
  // Um caminho que não casa com rota nenhuma. É a página que aparece quando
  // algo já deu errado, e era a mais difícil de proteger: nenhuma lista de
  // rotas alcança o que, por definição, não está em lista.
  { nome: 'caminho inexistente', caminho: '/isto-nao-existe', estatica: false, status: 404 },
  { nome: 'landing', caminho: '/', estatica: true },
  { nome: 'privacidade', caminho: '/privacidade', estatica: true },
];

const cardapio = await umCardapio();
if (cardapio) {
  // A superfície MAIS exposta: a única página que qualquer pessoa na rua abre.
  // Ficou sem CSP nenhuma enquanto o middleware a excluía do matcher.
  superficies.push({ nome: 'cardápio do cliente', caminho: cardapio, estatica: false });
} else {
  falhas.push('não achei nenhuma mesa ativa para testar o cardápio');
}

for (const s of superficies) {
  // Quantas falhas havia ANTES desta superfície. Sem isto o ✓ era impresso
  // junto com o ✗ da mesma rota, e a saída se contradizia em duas linhas
  // seguidas — que é o tipo de relatório que treina todo mundo a não ler.
  const antes = falhas.length;
  const ok = () => falhas.length === antes;
  const { status, csp, html } = await buscar(s.caminho);

  if (!csp) {
    falhas.push(`${s.nome}: sem Content-Security-Policy`);
    continue;
  }
  if (s.status !== undefined && status !== s.status) {
    falhas.push(`${s.nome}: respondeu ${status}, esperava ${s.status}`);
  }

  const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? '';
  const doCabecalho = nonceDoCabecalho(csp);
  const doCorpo = nonceDoCorpo(html);

  // Estes valem nos dois modos.
  if (scriptSrc.includes("'unsafe-eval'")) {
    falhas.push(`${s.nome}: script-src tem 'unsafe-eval' em produção`);
  }
  for (const exigida of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
    // Sem `base-uri`, uma injeção de `<base>` reescreve o destino de TODO
    // caminho relativo da página, incluindo os scripts do Next.
    if (!csp.includes(exigida)) falhas.push(`${s.nome}: sem ${exigida}`);
  }

  if (s.estatica) {
    if (doCabecalho) {
      falhas.push(
        `${s.nome}: é pré-renderizada e recebeu nonce — o HTML de build não tem ` +
          `como carregá-lo, então todo script da página está bloqueado`,
      );
    }
    if (!scriptSrc.includes("'self'")) {
      falhas.push(`${s.nome}: sem nonce E sem 'self' — nem os chunks carregam`);
    }
    if (ok()) console.log(`  ✓ ${s.nome}: estática, CSP sem nonce, 'self' cobrindo os chunks`);
    continue;
  }

  if (!doCabecalho) {
    falhas.push(`${s.nome}: script-src sem nonce`);
  }
  if (scriptSrc.includes("'unsafe-inline'")) {
    // Com `unsafe-inline` presente, o navegador ignora o nonce e libera
    // qualquer script inline. A CSP fica no cabeçalho e não protege nada.
    falhas.push(`${s.nome}: script-src tem 'unsafe-inline' — o nonce vira enfeite`);
  }
  // A verificação que faltava. Cabeçalho e HTML têm que falar do MESMO nonce.
  if (!doCorpo) {
    falhas.push(
      `${s.nome}: o cabeçalho manda nonce mas o HTML não tem nenhum — ` +
        `a página está sendo servida sem JavaScript nenhum`,
    );
  } else if (doCorpo !== doCabecalho) {
    falhas.push(`${s.nome}: nonce do HTML difere do cabeçalho`);
  } else if (ok()) {
    console.log(`  ✓ ${s.nome}: dinâmica, nonce do cabeçalho aplicado no HTML`);
  }
}

/* ── 3. o nonce não se repete ─────────────────────────────────────────────── */

const a = nonceDoCabecalho((await buscar('/app/entrar')).csp);
const b = nonceDoCabecalho((await buscar('/app/entrar')).csp);

if (!a || !b || a === b) {
  falhas.push('o nonce se repete entre requisições — previsível deixa de ser nonce');
} else {
  console.log('  ✓ nonce diferente a cada requisição');
}

console.log('');
if (falhas.length > 0) {
  for (const f of falhas) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ CSP casa com o modo de renderização em todas as superfícies');
process.exit(0);
