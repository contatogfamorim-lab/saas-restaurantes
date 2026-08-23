/**
 * Fumaça de rotas: toda página responde, e nenhuma entra em laço.
 *
 *   pnpm dev            # noutro terminal
 *   pnpm check:routes
 *
 * Existe por causa de um bug real: a página de login vivia dentro do layout
 * que exige login, então ela redirecionava para si mesma para sempre. Nenhum
 * teste de banco pegaria isso — a lógica de dados estava perfeita. Só carregar
 * a URL revela.
 *
 * É o mínimo: não julga aparência, não clica em nada. Só garante que cada rota
 * termina em algum lugar, e que o guarda de autenticação leva ao login em vez
 * de girar.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const MAX_SALTOS = 5;

interface Caso {
  caminho: string;
  espera: 'pagina' | 'login';
  descricao: string;
}

const CASOS: Caso[] = [
  { caminho: '/app/entrar', espera: 'pagina', descricao: 'login abre sem laço' },
  { caminho: '/app', espera: 'login', descricao: 'raiz da equipe exige login' },
  { caminho: '/app/salao', espera: 'login', descricao: 'salão exige login' },
  { caminho: '/privacidade', espera: 'pagina', descricao: 'aviso de dados é público' },
];

/** Segue redirecionamentos à mão, para poder DETECTAR o laço em vez de sofrê-lo. */
async function seguir(caminho: string) {
  const visitados: string[] = [];
  let url = new URL(caminho, BASE).toString();

  for (let i = 0; i <= MAX_SALTOS; i++) {
    const semQuery = new URL(url).pathname;
    if (visitados.includes(semQuery)) {
      return { laco: true, cadeia: [...visitados, semQuery], status: 0, url };
    }
    visitados.push(semQuery);

    const res = await fetch(url, { redirect: 'manual' });

    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get('location');
      if (!destino) return { laco: false, cadeia: visitados, status: res.status, url };
      url = new URL(destino, BASE).toString();
      continue;
    }

    return { laco: false, cadeia: visitados, status: res.status, url };
  }

  return { laco: true, cadeia: visitados, status: 0, url };
}

async function main() {
  try {
    await fetch(BASE, { redirect: 'manual' });
  } catch {
    console.error(`✗ Nada respondendo em ${BASE}. Suba o servidor com \`pnpm dev\`.`);
    process.exit(1);
  }

  let falhou = false;

  for (const caso of CASOS) {
    const r = await seguir(caso.caminho);

    if (r.laco) {
      console.error(
        `  ✗ ${caso.caminho.padEnd(16)} LAÇO DE REDIRECIONAMENTO: ${r.cadeia.join(' → ')}`,
      );
      falhou = true;
      continue;
    }

    const destino = new URL(r.url).pathname;

    // 'pagina' = a rota se serve, sem ser desviada.
    // 'login'  = a rota é protegida e o guarda leva ao login.
    const esperado = caso.espera === 'login' ? '/app/entrar' : caso.caminho;
    const ok = r.status === 200 && destino === esperado;

    console[ok ? 'log' : 'error'](
      `  ${ok ? '✓' : '✗'} ${caso.caminho.padEnd(16)} ${r.status} → ${destino}` +
        `  (${caso.descricao})`,
    );

    if (!ok) falhou = true;
  }

  if (falhou) {
    console.error('\n✗ Alguma rota não responde como deveria.');
    process.exit(1);
  }

  console.log(`\n✓ ${CASOS.length} rotas respondem, nenhuma em laço.`);
}

main().catch((err) => {
  console.error('✗ check-routes falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
