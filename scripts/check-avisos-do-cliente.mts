/**
 * O cliente já cadastrado liga e desliga os avisos na própria conta.
 *
 * Era o buraco da Fase 0: a caixa de aceite só existia no CADASTRO. Quem já era
 * cliente da casa não tinha por onde dizer sim, e quem tinha dito sim só
 * conseguia sair pelo link de uma mensagem que talvez nunca chegasse —
 * justamente porque ele estava fora da lista.
 *
 * A verificação passa pelo HTTP de verdade, com o cookie assinado que a
 * aplicação assina, e confere o que a TELA mostra — que era o que faltava.
 *
 * O CLIQUE em si não é simulado aqui: quem muda o estado neste script é a
 * função do banco, e o que se verifica é a tela refletir o estado novo. O
 * clique foi percorrido à mão no navegador, e o que garante que ele continua
 * ligado à função é o tipo da action mais o `pnpm verify`.
 */
import { SignJWT } from 'jose';
import { Client } from 'pg';

// `BASE_URL` é o que o `verify.mts` injeta, e ele sobe o servidor na 3100 —
// não na 3000. Eu tinha fixado 3000 aqui, e os dois scripts vinham passando
// só porque havia um `next dev` meu ligado naquela porta: contra a CI limpa
// teriam falhado sempre, e contra a minha máquina testavam o servidor errado.
const BASE = process.env.BASE_URL ?? process.env.SMOKE_BASE ?? 'http://localhost:3000';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let falhas = 0;
function ok(passou: boolean, descricao: string, detalhe = '') {
  if (passou) console.log(`  ✓ ${descricao}`);
  else {
    falhas++;
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

const db = new Client({ connectionString: DATABASE_URL });
await db.connect();

const { rows: mesas } = await db.query(
  `select short_code, restaurant_id from public.restaurant_tables
    where active limit 1`,
);
const { short_code, restaurant_id } = mesas[0];

// Um cliente que JÁ EXISTE e nunca aceitou — o caso que não tinha saída.
const cpf = String(Math.floor(10_000_000_000 + Math.random() * 89_999_999_999));
const { rows: cli } = await db.query(
  `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
   values ($1, $2, 'Cliente Antigo', '11987651234', 'x') returning id`,
  [restaurant_id, cpf],
);
const clienteId = cli[0].id as string;

/** O mesmo cookie que `abrirContaDoCliente` assina. */
const token = await new SignJWT({
  cid: clienteId,
  rid: restaurant_id,
  nome: 'Cliente Antigo',
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('30d')
  .sign(new TextEncoder().encode(process.env.SESSION_COOKIE_SECRET!));

const cookie = `cliente_conta=${token}`;

async function pagina() {
  const r = await fetch(`${BASE}/m/${short_code}/conta`, { headers: { cookie } });
  return (await r.text())
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

async function estaNoPublico(): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from public.publico_de_marketing where id = $1`,
    [clienteId],
  );
  return rows.length === 1;
}

console.log('\n──── a caixa aparece para quem já tinha conta ────');
{
  const texto = await pagina();
  ok(texto.includes('Avisos de saldo e promoções no WhatsApp'), 'a tela oferece os avisos');
  ok(
    texto.includes('Você não recebe nada hoje'),
    'e diz o estado REAL: hoje ele não recebe',
  );
  ok(!(await estaNoPublico()), 'e o banco concorda: fora do público');
}

console.log('\n──── ele aceita, e passa a receber ────');
{
  await db.query(`select public.aceitar_marketing($1)`, [clienteId]);
  ok(await estaNoPublico(), 'entrou no público');
  const texto = await pagina();
  ok(texto.includes('Você recebe'), 'e a tela passa a dizer que ele recebe');
}

console.log('\n──── ele desmarca, e para de receber ────');
{
  const { rows } = await db.query(
    `select unsubscribe_token as t from public.customers where id = $1`,
    [clienteId],
  );
  await db.query(`select public.descadastrar_marketing($1)`, [rows[0].t]);
  ok(!(await estaNoPublico()), 'saiu do público');
  const texto = await pagina();
  ok(texto.includes('Você não recebe nada hoje'), 'e a tela volta a dizer que não recebe');
}

console.log('\n──── sem telefone, a caixa nem aparece ────');
{
  await db.query(`update public.customers set phone = null where id = $1`, [clienteId]);
  const texto = await pagina();
  ok(
    !texto.includes('Avisos de saldo e promoções no WhatsApp'),
    'não oferece o que não tem para onde mandar',
  );
}

// A conta de teste sai; o audit_log dela fica, porque é imutável por desenho.
await db.query(`delete from public.customers where id = $1`, [clienteId]).catch(() => {});
await db.end();

if (falhas > 0) {
  console.log(`\n✗ ${falhas} verificação(ões) falharam.\n`);
  process.exit(1);
}
console.log('\n✓ o cliente já cadastrado controla os próprios avisos.\n');
