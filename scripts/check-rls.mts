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
    // `restaurants` NÃO entra: o cardápio público resolve mesa e restaurante no
    // servidor, com o client de admin. Enquanto o anônimo lia a tabela, ele
    // listava os clientes da plataforma inteira (migration 0032).
    'categories',
    'products',
    'modifier_groups',
    'modifier_options',
    'product_modifier_groups',
    // Os selos entram porque são CARDÁPIO: rótulo, cor e animação do que o
    // cliente vê no card. Não há dado de pessoa nem de dinheiro aqui, e a
    // policy só devolve os ativos de restaurante ativo.
    //
    // A linha existe para ser DELIBERADA. O script acusou a tabela nova no
    // primeiro `pnpm verify` depois da 0043 — que é exatamente o que ele
    // deveria fazer, e o motivo de a lista ser exata em vez de um mínimo.
    'product_badges',
    // Restrições, pelo mesmo motivo dos selos: são CARDÁPIO. E aqui pesa mais —
    // é por elas que o cliente celíaco filtra. Sem leitura pública, o filtro
    // volta vazio e o prato seguro fica invisível para quem mais precisa dele.
    'diet_restrictions',
  ]);

  const { rows: grantsAnon } = await client.query<{ table_name: string; privilege_type: string }>(`
    select distinct table_name, privilege_type
    from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  `);

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

  // -------------------------------------------------------------------------
  // VIEWS: `security_invoker` e o portão de papel.
  //
  // View não tem RLS própria — o bloco acima não a enxerga. Com
  // `security_invoker = off` (o PADRÃO do Postgres) ela lê as tabelas como
  // DONA, ignorando toda a RLS abaixo: uma view assim é um buraco no formato
  // exato do isolamento entre restaurantes, e nada aqui acusaria.
  //
  // As views de relatório levam uma exigência a mais: `can_view_reports()` na
  // definição. Sem ela, a cozinha soma o faturamento da casa pelo PostgREST.
  // -------------------------------------------------------------------------
  const RELATORIOS = new Set([
    'daily_sales', 'payment_mix', 'product_sales', 'kitchen_performance',
    'rejected_items', 'promotion_performance', 'staff_money_actions',
    'customer_directory',
  ]);

  const { rows: views } = await client.query<{
    view_name: string;
    invoker: boolean;
    definicao: string;
  }>(`
    select
      c.relname as view_name,
      -- O Postgres guarda a opção com a palavra que foi escrita: quem usa
      -- "security_invoker = on" grava "on", quem usa "= true" grava "true".
      -- Comparar com uma só reprova view correta — e um alarme falso treina
      -- todo mundo a ignorar este script.
      coalesce(
        (select option_value from pg_options_to_table(c.reloptions)
          where option_name = 'security_invoker') in ('on', 'true'),
        false
      ) as invoker,
      pg_get_viewdef(c.oid) as definicao
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
    order by c.relname
  `);

  await client.end();

  const semInvoker = views.filter((v) => !v.invoker);
  const semPortao = views.filter(
    (v) => RELATORIOS.has(v.view_name) && !v.definicao.includes('can_view_reports'),
  );
  const relatoriosFaltando = [...RELATORIOS].filter(
    (r) => !views.some((v) => v.view_name === r),
  );

  console.log('');
  for (const v of views) {
    const gate = RELATORIOS.has(v.view_name) ? ' + portão de papel' : '';
    const ok = v.invoker && !semPortao.includes(v);
    console.log(`  ${ok ? '✓' : '✗'} ${v.view_name.padEnd(28)} invoker=${v.invoker}${gate}`);
  }

  if (semInvoker.length > 0) {
    console.error(
      `\n✗ view SEM security_invoker: ${semInvoker.map((v) => v.view_name).join(', ')}`,
    );
    console.error('  Ela lê as tabelas como dona e passa por cima da RLS.');
  }
  if (semPortao.length > 0) {
    console.error(
      `\n✗ relatório SEM app.can_view_reports(): ${semPortao.map((v) => v.view_name).join(', ')}`,
    );
    console.error('  Sem o portão, qualquer funcionário soma o faturamento da casa.');
  }
  if (relatoriosFaltando.length > 0) {
    console.error(`\n✗ view de relatório sumiu: ${relatoriosFaltando.join(', ')}`);
    console.error('  Se foi removida de propósito, tire da lista deste script.');
  }

  const falhou =
    semRls.length > 0 || semPolicy.length > 0 ||
    escritas.length > 0 || aMais.length > 0 || aMenos.length > 0 ||
    semInvoker.length > 0 || semPortao.length > 0 || relatoriosFaltando.length > 0;
  if (falhou) process.exit(1);

  console.log(`\n✓ ${rows.length} tabelas, todas com RLS habilitada e ao menos uma policy.`);
  console.log(`✓ ${views.length} views, todas com security_invoker; ${RELATORIOS.size} com portão de papel.`);
  console.log(`✓ anon lê exatamente as ${leituras.size} tabelas do cardápio público, e escreve em nenhuma.`);
}

main().catch((err) => {
  console.error('✗ check-rls falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
