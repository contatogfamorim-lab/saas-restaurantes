/**
 * Roda LOCALMENTE o que a CI roda, na mesma ordem.
 *
 *     pnpm verify
 *
 * Por que um script e não uma corrente de `&&` no package.json: duas das
 * guardas têm pré-requisito de ordem que uma corrente não expressa, e que
 * errada faz a guarda passar por vacuidade —
 *
 *   `check:secrets` varre `.next/static`. Antes do build não há nada para
 *   varrer, e o script diz "nenhum segredo encontrado" com toda a convicção.
 *
 *   `check:routes` precisa de um servidor de pé. Sem ele o script falha por
 *   conexão recusada, que é ruído e não resposta.
 *
 * O servidor sobe numa porta própria (3100) para não brigar com o `pnpm dev`
 * de quem está no meio de outra coisa.
 */
import { spawn, spawnSync } from 'node:child_process';

const PORTA = Number(process.env.VERIFY_PORT ?? 3100);
const BASE = `http://localhost:${PORTA}`;

interface Passo {
  nome: string;
  comando: string;
  args: string[];
  /** Alguns passos precisam do servidor de produção no ar. */
  comServidor?: boolean;
}

const PASSOS: Passo[] = [
  { nome: 'tipos', comando: 'pnpm', args: ['typecheck'] },
  { nome: 'lint', comando: 'pnpm', args: ['lint'] },
  { nome: 'testes de unidade', comando: 'pnpm', args: ['test'] },
  { nome: 'RLS em todas as tabelas', comando: 'pnpm', args: ['db:check-rls'] },
  { nome: 'testes contra o banco', comando: 'pnpm', args: ['test:db'] },
  { nome: 'isolamento no realtime', comando: 'pnpm', args: ['check:realtime'] },
  { nome: 'build de produção', comando: 'pnpm', args: ['build'] },
  // DEPOIS do build, sempre.
  { nome: 'nenhum segredo no bundle', comando: 'pnpm', args: ['check:secrets'] },
  { nome: 'rotas e portas fechadas', comando: 'pnpm', args: ['check:routes'], comServidor: true },
  { nome: 'CSP com nonce', comando: 'pnpm', args: ['check:csp'], comServidor: true },
  { nome: 'força bruta freada', comando: 'pnpm', args: ['check:forca-bruta'], comServidor: true },
];

type Servidor = ReturnType<typeof spawn>;

const falhas: string[] = [];
let servidor: Servidor | undefined;

/**
 * Sobe o servidor e DEVOLVE o processo, em vez de atribuir a uma variável de
 * fora.
 *
 * A primeira versão atribuía direto e o `servidor?.kill()` lá embaixo não
 * compilava: o TypeScript não enxerga atribuição feita dentro de outra função,
 * então estreitava o tipo para `never`. Isso derrubou o `next build` — que
 * também typa `scripts/` — e o servidor não subiu porque não havia build.
 * Foi o próprio `verify` reprovando o `verify`.
 */
async function subirServidor(): Promise<Servidor | undefined> {
  const processo = spawn('pnpm', ['start'], {
    env: { ...process.env, PORT: String(PORTA) },
    stdio: 'ignore',
  });

  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (r.ok || r.status < 500) return processo;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  processo.kill();
  return undefined;
}

for (const passo of PASSOS) {
  if (passo.comServidor && !servidor) {
    process.stdout.write('  … subindo o servidor de produção\n');
    servidor = await subirServidor();
    if (!servidor) {
      falhas.push(`${passo.nome} (o servidor não subiu)`);
      continue;
    }
  }

  process.stdout.write(`\n──── ${passo.nome} ────\n`);
  const r = spawnSync(passo.comando, passo.args, {
    stdio: 'inherit',
    env: passo.comServidor ? { ...process.env, BASE_URL: BASE } : process.env,
  });

  if (r.status !== 0) falhas.push(passo.nome);
}

servidor?.kill();

console.log('');
if (falhas.length > 0) {
  console.error(`✗ ${falhas.length} passo(s) falharam: ${falhas.join(', ')}`);
  process.exit(1);
}
console.log(`✓ os ${PASSOS.length} passos da CI passaram aqui.`);
process.exit(0);
