/**
 * A CSP existe, cobre as duas superfícies e não é decorativa.
 *
 * O erro que este script existe para pegar não é "falta CSP" — é CSP que
 * PARECE estar lá e não protege: `unsafe-inline` no `script-src` anula o
 * nonce inteiro, `unsafe-eval` deixado ligado em produção reabre o buraco, e
 * nonce repetido entre requisições deixa de ser nonce.
 *
 * Nenhuma dessas três aparece no navegador: a página carrega, o cabeçalho está
 * no DevTools, e tudo parece certo.
 *
 *     pnpm build && pnpm start &
 *     pnpm check:csp
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

interface Superficie {
  nome: string;
  caminho: string;
}

async function cspDe(caminho: string): Promise<string | null> {
  const r = await fetch(`${BASE}${caminho}`, { redirect: 'manual' });
  return r.headers.get('content-security-policy');
}

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

const falhas: string[] = [];

const superficies: Superficie[] = [
  { nome: 'tela da equipe', caminho: '/app/entrar' },
  { nome: 'raiz', caminho: '/' },
];

const cardapio = await umCardapio();
if (cardapio) {
  // A superfície MAIS exposta: a única página que qualquer pessoa na rua abre.
  // Ficou sem CSP nenhuma enquanto o middleware a excluía do matcher.
  superficies.push({ nome: 'cardápio do cliente', caminho: cardapio });
} else {
  falhas.push('não achei nenhuma mesa ativa para testar o cardápio');
}

for (const s of superficies) {
  const csp = await cspDe(s.caminho);

  if (!csp) {
    falhas.push(`${s.nome}: sem Content-Security-Policy`);
    continue;
  }

  const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? '';

  if (!/'nonce-[A-Za-z0-9+/=]+'/.test(scriptSrc)) {
    falhas.push(`${s.nome}: script-src sem nonce`);
  }
  if (scriptSrc.includes("'unsafe-inline'")) {
    // Com `unsafe-inline` presente, o navegador ignora o nonce e libera
    // qualquer script inline. A CSP fica no cabeçalho e não protege nada.
    falhas.push(`${s.nome}: script-src tem 'unsafe-inline' — o nonce vira enfeite`);
  }
  if (scriptSrc.includes("'unsafe-eval'")) {
    falhas.push(`${s.nome}: script-src tem 'unsafe-eval' em produção`);
  }
  if (!csp.includes("object-src 'none'")) {
    falhas.push(`${s.nome}: sem object-src 'none'`);
  }
  if (!csp.includes("frame-ancestors 'none'")) {
    falhas.push(`${s.nome}: sem frame-ancestors — a tela pode ser embutida`);
  }
  if (!csp.includes("base-uri 'self'")) {
    // Sem `base-uri`, uma injeção de `<base>` reescreve o destino de TODO
    // caminho relativo da página, incluindo os scripts do Next.
    falhas.push(`${s.nome}: sem base-uri 'self'`);
  }

  console.log(`  ✓ ${s.nome}: CSP com nonce, sem unsafe-*`);
}

// Nonce repetido entre requisições é o mesmo que nonce previsível.
const a = (await cspDe('/app/entrar'))?.match(/'nonce-([^']+)'/)?.[1];
const b = (await cspDe('/app/entrar'))?.match(/'nonce-([^']+)'/)?.[1];

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
console.log('✓ CSP com nonce nas telas da equipe e no cardápio do cliente');
process.exit(0);
