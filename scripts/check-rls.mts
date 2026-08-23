/**
 * FALHA O BUILD se existir tabela em `public` sem RLS, ou com RLS mas sem
 * nenhuma policy (spec §10.2).
 *
 * No Supabase, tabela sem RLS + chave anon = leitura pública pela internet.
 * É um erro silencioso: nada quebra, o dado só vaza. Por isso é teste de CI e
 * não item de checklist.
 *
 *   pnpm db:check-rls
 *
 * Conecta direto no Postgres (DATABASE_URL), não pelo PostgREST: o que
 * interessa aqui é o catálogo do banco.
 */
import { Client } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Tabelas que podem existir sem policy porque a ausência de policy JÁ é a
 * regra pretendida. Manter esta lista vazia sempre que possível.
 */
const TABLES_WITHOUT_POLICIES_OK = new Set<string>([]);

type Row = { table_name: string; rls_enabled: boolean; policy_count: number };

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const { rows } = await client.query<Row>(`
    select
      c.relname                        as table_name,
      c.relrowsecurity                 as rls_enabled,
      count(p.polname)::int            as policy_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_policy p on p.polrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not like 'pg_%'
    group by c.relname, c.relrowsecurity
    order by c.relname
  `);

  if (rows.length === 0) {
    await client.end();
    console.error('✗ Nenhuma tabela encontrada em public. O banco subiu e as migrations rodaram?');
    process.exit(1);
  }

  const semRls = rows.filter((r) => !r.rls_enabled);
  const semPolicy = rows.filter(
    (r) => r.rls_enabled && r.policy_count === 0 && !TABLES_WITHOUT_POLICIES_OK.has(r.table_name),
  );

  for (const r of rows) {
    const mark = !r.rls_enabled ? '✗' : r.policy_count === 0 ? '!' : '✓';
    console.log(`  ${mark} ${r.table_name.padEnd(28)} rls=${r.rls_enabled} policies=${r.policy_count}`);
  }

  if (semRls.length > 0) {
    console.error(
      `\n✗ ${semRls.length} tabela(s) SEM RLS: ${semRls.map((r) => r.table_name).join(', ')}`,
    );
  }
  if (semPolicy.length > 0) {
    console.error(
      `\n✗ ${semPolicy.length} tabela(s) com RLS e NENHUMA policy: ` +
        `${semPolicy.map((r) => r.table_name).join(', ')}\n` +
        '  (isso nega tudo — se for intencional, declare em TABLES_WITHOUT_POLICIES_OK)',
    );
  }

  // ---------------------------------------------------------------------------
  // Superfície do anon, conferida NOS DOIS SENTIDOS.
  //
  // Checar só "anon não escreve" passa por vacuidade quando anon não tem
  // privilégio nenhum — foi exatamente o que aconteceu aqui: as tabelas
  // nasceram sem GRANT, o script deu verde, e o cardápio público não abria.
  // Então: a lista de SELECT precisa ser EXATAMENTE a esperada, nem mais nem
  // menos, e escrita tem que ser zero.
  // ---------------------------------------------------------------------------
  const ANON_SELECT_ESPERADO = new Set([
    'restaurants',
    'categories',
    'products',
    'modifier_groups',
    'modifier_options',
    'product_modifier_groups',
  ]);

  const { rows: grantsAnon } = await client.query<{ table_name: string; privilege_type: string }>(`
    select distinct table_name, privilege_type
    from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  `);

  await client.end();

  const escritas = grantsAnon.filter((g) => g.privilege_type !== 'SELECT');
  const leituras = new Set(
    grantsAnon.filter((g) => g.privilege_type === 'SELECT').map((g) => g.table_name),
  );

  const aMais = [...leituras].filter((t) => !ANON_SELECT_ESPERADO.has(t));
  const aMenos = [...ANON_SELECT_ESPERADO].filter((t) => !leituras.has(t));

  if (escritas.length > 0) {
    console.error(`\n✗ anon tem privilégio de ESCRITA em ${escritas.length} caso(s):`);
    for (const e of escritas) console.error(`    ${e.table_name}: ${e.privilege_type}`);
  }
  if (aMais.length > 0) {
    console.error(`\n✗ anon lê tabela que NÃO deveria: ${aMais.join(', ')}`);
    console.error('  Cardápio é público; comanda, cliente e pagamento não são.');
  }
  if (aMenos.length > 0) {
    console.error(`\n✗ anon NÃO lê tabela que precisa: ${aMenos.join(', ')}`);
    console.error('  Sem isto o cardápio público não abre — e é o produto inteiro.');
  }

  const falhou =
    semRls.length > 0 || semPolicy.length > 0 ||
    escritas.length > 0 || aMais.length > 0 || aMenos.length > 0;
  if (falhou) process.exit(1);

  console.log(`\n✓ ${rows.length} tabelas, todas com RLS habilitada e ao menos uma policy.`);
  console.log(`✓ anon lê exatamente as ${leituras.size} tabelas do cardápio público, e escreve em nenhuma.`);
}

main().catch((err) => {
  console.error('✗ check-rls falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
