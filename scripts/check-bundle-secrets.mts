/**
 * FALHA O BUILD se algum segredo aparecer no bundle de produção (spec §10.10).
 *
 * Vazar a `service_role_key` no JavaScript do cliente entrega o banco inteiro:
 * ela ignora RLS. É o tipo de erro que passa em toda revisão de código e só
 * aparece quando alguém abre o DevTools.
 *
 *   pnpm build && pnpm check:secrets
 *
 * Faz duas coisas:
 *  1. procura no `.next` os PADRÕES de segredo (nome da variável e formato de
 *     chave), o que pega o erro mesmo em projeto novo sem .env preenchido;
 *  2. procura os VALORES literais das variáveis de servidor presentes no
 *     ambiente, o que pega vazamento por interpolação acidental.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const BUILD_DIR = path.resolve(process.cwd(), '.next');

/**
 * SÓ `.next/static` é servido ao browser.
 *
 * `.next/server` e `.next/dev` são código de servidor — a chave service_role
 * aparece lá por construção, e apontar o dedo para isso é ruído que treina
 * todo mundo a ignorar o alerta.
 */
const CLIENT_DIR = path.join(BUILD_DIR, 'static');

/** Extensões que de fato chegam ao browser. */
const CLIENT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.map', '.json', '.html', '.css']);

/**
 * O grep literal por "service_role" que a spec §10.10 sugere dispara em falso:
 * `@supabase/auth-js` carrega a string no próprio código, então qualquer bundle
 * que use o SDK acusaria. Um alerta que grita sempre não protege nada.
 *
 * O que importa é a CREDENCIAL, não a palavra. Então: o nome da variável de
 * ambiente (que só apareceria se alguém a importasse no cliente), o valor
 * literal dela, e um JWT cujo payload declare role service_role.
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'SUPABASE_SERVICE_ROLE_KEY', re: /SUPABASE_SERVICE_ROLE_KEY/ },
  { label: 'SESSION_COOKIE_SECRET', re: /SESSION_COOKIE_SECRET/ },
  // JWT do Supabase cujo payload declara role service_role
  { label: 'JWT com role service_role', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/ },
  // chave nova do Supabase (formato sb_secret_*)
  { label: 'secret key do Supabase', re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
];

/** Valores literais que, se presentes no ambiente, não podem estar no bundle. */
const SECRET_ENV_VARS = ['SUPABASE_SERVICE_ROLE_KEY', 'SESSION_COOKIE_SECRET'];

type Finding = { file: string; label: string; line: number; excerpt: string };

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) {
      yield* walk(full);
    } else if (CLIENT_EXTENSIONS.has(path.extname(entry))) {
      yield full;
    }
  }
}

async function main() {
  const clientExists = await stat(CLIENT_DIR).catch(() => null);
  if (!clientExists) {
    console.error(
      '✗ .next/static não existe. Rode `pnpm build` antes de `pnpm check:secrets`.\n' +
        '  (a saída de `pnpm dev` não serve: dev não gera o bundle de cliente)',
    );
    process.exit(1);
  }

  const literals = SECRET_ENV_VARS.map((name) => ({ name, value: process.env[name] }))
    .filter((v): v is { name: string; value: string } => Boolean(v.value && v.value.length >= 12));

  const findings: Finding[] = [];
  let scanned = 0;

  for await (const file of walk(CLIENT_DIR)) {
    scanned += 1;
    const content = await readFile(file, 'utf8').catch(() => null);
    if (!content) continue;

    const checks = [
      ...FORBIDDEN_PATTERNS.map((p) => ({ label: p.label, test: (l: string) => p.re.test(l) })),
      ...literals.map((l) => ({
        label: `valor literal de ${l.name}`,
        test: (line: string) => line.includes(l.value),
      })),
    ];

    const lines = content.split('\n');
    for (const [i, line] of lines.entries()) {
      for (const check of checks) {
        if (check.test(line)) {
          findings.push({
            file: path.relative(process.cwd(), file),
            label: check.label,
            line: i + 1,
            // nunca imprimir o segredo em si
            excerpt: line.slice(0, 60).replace(/\s+/g, ' '),
          });
        }
      }
    }
  }

  if (findings.length > 0) {
    console.error(`\n✗ Segredo encontrado no bundle de cliente (${findings.length} ocorrência(s)):\n`);
    for (const f of findings.slice(0, 20)) {
      console.error(`  ${f.file}:${f.line} — ${f.label}`);
    }
    if (findings.length > 20) console.error(`  … e mais ${findings.length - 20}`);
    console.error('\n  Chave de servidor nunca com prefixo NEXT_PUBLIC_, e nunca importada');
    console.error('  por Client Component. Use @/lib/supabase/admin (server-only).');
    process.exit(1);
  }

  console.log(`✓ ${scanned} arquivos de cliente varridos, nenhum segredo encontrado.`);
}

main().catch((err) => {
  console.error('✗ check-bundle-secrets falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
