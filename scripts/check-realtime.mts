/**
 * §10.2 na prática: "confirme que um staff do restaurante A não recebe nenhum
 * evento do restaurante B".
 *
 * POR QUE ISTO NÃO É UM TESTE DE BANCO
 *
 * `tests/db/realtime.test.ts` prova que a policy de `realtime.messages` nega o
 * SELECT do tópico alheio. Isso é metade da história. Quem entrega o evento ao
 * navegador é o servidor Realtime — outro processo, em outra linguagem, com a
 * própria lógica de autorização de canal. A policy pode estar perfeita e o
 * servidor entregar assim mesmo; ou o inverso, a policy apertar demais e a
 * inscrição legítima parar de funcionar em silêncio.
 *
 * A única prova é assinar de verdade, mexer no banco de verdade e contar o que
 * chegou em cada ponta. É o que este script faz.
 *
 *     pnpm db:start && pnpm check:realtime
 *
 * Sai com código 1 se qualquer uma das quatro asserções falhar.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

if (!URL || !ANON) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY (.env.local).');
  process.exit(1);
}

const A = '11111111-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-1111-4111-8111-111111111111';
const DONO_B = 'bbbbbbbb-0000-4000-8000-000000000001';

const GARCOM_A_EMAIL = 'garcom@brasaburger.test';
const SENHA = process.env.SMOKE_SENHA ?? 'senha-de-teste-123';
const DONO_B_EMAIL = 'dono@concorrente.test';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Um assinante de canal, com o que recebeu e como terminou a inscrição. */
function assinar(sb: SupabaseClient, topico: string) {
  const recebidos: unknown[] = [];
  let estado = '(sem resposta)';

  sb.channel(topico, { config: { private: true } })
    .on('broadcast', { event: 'mudanca' }, ({ payload }) => recebidos.push(payload))
    .subscribe((s, err) => {
      estado = err ? `${s} (${err.message})` : s;
    });

  return { recebidos, estado: () => estado };
}

async function entrar(email: string, senha: string) {
  const sb = createClient(URL!, ANON!);
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(`login de ${email}: ${error.message}`);
  // Sem isto o canal privado é recusado — e recusado é o certo: sem identidade,
  // não há restaurante a que pertencer.
  await sb.realtime.setAuth();
  return sb;
}

const pg = new Client({ connectionString: DATABASE_URL });
await pg.connect();

// ---------------------------------------------------------------------------
// Restaurante B, o vizinho. Criado aqui para o script não depender de os testes
// de banco terem rodado antes.
// ---------------------------------------------------------------------------
// Os campos de token vão como '' e não NULL, e a identity é obrigatória: com
// NULL nessas colunas o GoTrue devolve "Database error querying schema" e o
// login falha sem dizer por quê. Mesma armadilha documentada no seed.
await pg.query(
  `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                           email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                           created_at, updated_at, confirmation_token, recovery_token,
                           email_change_token_new, email_change, email_change_token_current)
   values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
           $2, extensions.crypt($3, extensions.gen_salt('bf', 10)), now(),
           '{"provider":"email","providers":["email"]}'::jsonb,
           jsonb_build_object('name', 'Dono B'), now(), now(), '', '', '', '', '')
   on conflict (id) do update set
     encrypted_password         = excluded.encrypted_password,
     confirmation_token         = '',
     recovery_token             = '',
     email_change_token_new     = '',
     email_change               = '',
     email_change_token_current = ''`,
  [DONO_B, DONO_B_EMAIL, SENHA],
);
await pg.query(
  `insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                last_sign_in_at, created_at, updated_at)
   values (gen_random_uuid(), $1::uuid, $2::text,
           jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true),
           'email', now(), now(), now())
   on conflict (provider_id, provider) do nothing`,
  [DONO_B, DONO_B, DONO_B_EMAIL],
);
await pg.query(
  `insert into public.restaurants (id, name, slug) values ($1, 'Concorrente', 'concorrente')
   on conflict (id) do nothing`,
  [B],
);
await pg.query(
  `insert into public.profiles (id, restaurant_id, name, roles)
   values ($1, $2, 'Dono B', array['owner']::staff_role[]) on conflict (id) do nothing`,
  [DONO_B, B],
);
await pg.query(
  `insert into public.restaurant_tables (restaurant_id, label) values ($1, 'Mesa B1')
   on conflict do nothing`,
  [B],
);

// ---------------------------------------------------------------------------
const garcomA = await entrar(GARCOM_A_EMAIL, SENHA);
const donoB = await entrar(DONO_B_EMAIL, SENHA);

// O garçom de A entra DUAS VEZES, com conexões separadas: uma no próprio canal,
// outra tentando o do vizinho. Não é preciosismo — os dois canais no mesmo
// socket fazem a recusa do segundo derrubar o primeiro junto, e aí o script
// mediria "canal legítimo mudo" achando que era vazamento. Cada tela do app
// assina exatamente um canal, então dois clientes é o que espelha a realidade.
const garcomAInvasor = await entrar(GARCOM_A_EMAIL, SENHA);

const proprio = assinar(garcomA, `restaurante:${A}`);
const invasao = assinar(garcomAInvasor, `restaurante:${B}`);
const vizinho = assinar(donoB, `restaurante:${B}`);

// 8s: o canal negado precisa de tempo para RESPONDER que negou. Passar por
// silêncio seria o mesmo erro de sempre — a guarda passando à toa.
await espera(8000);

console.log('inscrição — garçom de A no canal de A ..:', proprio.estado());
console.log('inscrição — garçom de A no canal de B ..:', invasao.estado());
console.log('inscrição — dono de B no canal de B ....:', vizinho.estado());

// ---------------------------------------------------------------------------
// Movimento REAL nos dois restaurantes, pelas tabelas que a §9 lista.
// ---------------------------------------------------------------------------
const mesaA = await pg.query(
  `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
  [A],
);
const sessaoA = await pg.query(
  `insert into public.table_sessions (restaurant_id, table_id, guest_count)
   values ($1, $2, 2) returning id`,
  [A, mesaA.rows[0].id],
);
const chamadaA = await pg.query(
  `insert into public.waiter_calls (restaurant_id, session_id, table_id, type)
   values ($1, $2, $3, 'call_waiter') returning id`,
  [A, sessaoA.rows[0].id, mesaA.rows[0].id],
);

const mesaB = await pg.query(
  `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
  [B],
);
const sessaoB = await pg.query(
  `insert into public.table_sessions (restaurant_id, table_id, guest_count)
   values ($1, $2, 2) returning id`,
  [B, mesaB.rows[0].id],
);

await espera(3000);

console.log('');
console.log('eventos de A que chegaram em A .........:', proprio.recebidos.length);
console.log('eventos de B que chegaram em B .........:', vizinho.recebidos.length);
console.log('eventos QUAISQUER vazados para A .......:', invasao.recebidos.length);
console.log('');
console.log('payload visto por A ....................:', JSON.stringify(proprio.recebidos));
console.log('payload visto por B ....................:', JSON.stringify(vizinho.recebidos));

// ---------------------------------------------------------------------------
const falhas: string[] = [];

if (proprio.estado() !== 'SUBSCRIBED') {
  falhas.push(`garçom de A não conseguiu entrar no PRÓPRIO canal (${proprio.estado()})`);
}
if (vizinho.estado() !== 'SUBSCRIBED') {
  falhas.push(`dono de B não conseguiu entrar no próprio canal (${vizinho.estado()})`);
}
if (proprio.recebidos.length === 0 || vizinho.recebidos.length === 0) {
  falhas.push('canal legítimo não recebeu evento nenhum — o realtime está mudo');
}
if (invasao.recebidos.length > 0) {
  falhas.push(
    `VAZOU: garçom de A recebeu ${invasao.recebidos.length} evento(s) do restaurante B`,
  );
}
if (invasao.estado() === 'SUBSCRIBED') {
  falhas.push('garçom de A foi ACEITO no canal do restaurante B');
}

// ---------------------------------------------------------------------------
// O payload não pode carregar conteúdo de linha (§10.2).
//
// Ele chega com um `id` que o próprio `realtime.send` acrescenta — e a pergunta
// que importa não é "quais chaves vieram", é se algum desses valores identifica
// uma LINHA. Como o script acabou de criar as linhas, dá para conferir contra
// os ids de verdade, em vez de confiar no nome do campo.
// ---------------------------------------------------------------------------
const idsDeLinhaReais = new Set([sessaoA.rows[0].id, sessaoB.rows[0].id, chamadaA.rows[0].id]);

for (const p of [...proprio.recebidos, ...vizinho.recebidos]) {
  const valores = Object.values(p as Record<string, unknown>).map(String);
  const vazado = valores.find((v) => idsDeLinhaReais.has(v));
  if (vazado) {
    falhas.push(`payload carrega id de linha real (${vazado}): ${JSON.stringify(p)}`);
  }

  const extras = Object.keys(p as object).filter((k) => !['tabela', 'op', 'id'].includes(k));
  if (extras.length > 0) {
    falhas.push(`payload tem campo inesperado (${extras.join(', ')}): ${JSON.stringify(p)}`);
  }
}

// ---------------------------------------------------------------------------
await pg.query(`delete from public.waiter_calls where session_id = $1`, [sessaoA.rows[0].id]);
await pg.query(`delete from public.table_sessions where id = any($1::uuid[])`, [
  [sessaoA.rows[0].id, sessaoB.rows[0].id],
]);
await pg.end();

console.log('');
if (falhas.length > 0) {
  for (const f of falhas) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ §10.2 — isolamento entre tenants confirmado no caminho real');
// Os websockets seguram o event loop; sem isto o script termina e o processo
// fica pendurado para sempre.
process.exit(0);
