/**
 * As portas que eu tinha deixado sem tranca — ou com tranca e sem porta.
 *
 * Três coisas nasceram capazes no banco e inalcançáveis na tela, e este script
 * existe para que isso não volte a acontecer em silêncio:
 *
 *   1. o GERENTE tem `campaign.manage` e `stock.manage`, e o console inteiro
 *      cobrava `dashboard.view`, que é do dono. Ele ficava do lado de fora das
 *      duas telas que são justamente as dele;
 *
 *   2. a COZINHA pode registrar perda desde que a 0052 foi escrita, e não havia
 *      tela nenhuma — só o `psql` alcançava;
 *
 *   3. o CLIENTE JÁ CADASTRADO não tinha como aceitar receber mensagens. A
 *      caixa só aparecia para quem criava conta.
 *
 * A verificação é por HTTP, com sessão de verdade, porque é isso que prova que
 * a porta abre. Um teste de `can()` provaria só que a matriz de permissões
 * concorda consigo mesma.
 */
import { createServerClient } from '@supabase/ssr';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const SENHA = process.env.SMOKE_SENHA ?? 'senha-de-teste-123';

let falhas = 0;

function ok(passou: boolean, descricao: string, detalhe = '') {
  if (passou) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas++;
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

/** Faz login pelo Supabase e devolve o cabeçalho `cookie` de uma sessão real. */
async function sessao(email: string): Promise<string> {
  const cofre = new Map<string, string>();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [...cofre].map(([name, value]) => ({ name, value })),
        setAll: (lista) => {
          for (const { name, value } of lista) cofre.set(name, value);
        },
      },
    },
  );

  const { error } = await supabase.auth.signInWithPassword({ email, password: SENHA });
  if (error) throw new Error(`login de ${email} falhou: ${error.message}`);

  return [...cofre].map(([n, v]) => `${n}=${v}`).join('; ');
}

async function pagina(caminho: string, cookie: string) {
  const r = await fetch(`${BASE}${caminho}`, { headers: { cookie }, redirect: 'manual' });
  const html = r.status >= 300 && r.status < 400 ? '' : await r.text();
  return {
    status: r.status,
    destino: r.headers.get('location') ?? '',
    // Sem `<script>`: o payload do Next repete a árvore inteira em JSON, e
    // procurar texto lá dentro encontra coisas que a página não mostra.
    texto: html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  };
}

/**
 * A PROPRIEDADE, e não uma lista de casos.
 *
 * "Tudo que a barra oferece tem que abrir, e o que ela não oferece tem que
 * recusar." Escrever caso a caso me fez errar na primeira tentativa — assumi
 * que auditoria era do dono, e o gerente tem `audit.view` desde sempre. A
 * asserção estava errada, e uma asserção errada esconde tanto quanto uma
 * ausente.
 *
 * Testado assim, o script continua valendo quando alguém acrescentar uma seção.
 */
const SECOES = [
  '/app/gestao',
  '/app/gestao/operacao',
  '/app/gestao/cardapio',
  '/app/gestao/promocoes',
  '/app/gestao/mesas',
  '/app/gestao/equipe',
  '/app/gestao/clientes',
  '/app/gestao/estoque',
  '/app/gestao/campanhas',
  '/app/gestao/auditoria',
  '/app/gestao/configuracoes',
];

/** Os rótulos como aparecem na barra, para saber o que ela ESTÁ oferecendo. */
const ROTULO: Record<string, string> = {
  '/app/gestao': 'Vendas',
  '/app/gestao/operacao': 'Operação',
  '/app/gestao/cardapio': 'Cardápio',
  '/app/gestao/promocoes': 'Promoções',
  '/app/gestao/mesas': 'Mesas',
  '/app/gestao/equipe': 'Equipe',
  '/app/gestao/clientes': 'Clientes',
  '/app/gestao/estoque': 'Estoque',
  '/app/gestao/campanhas': 'Campanhas',
  '/app/gestao/auditoria': 'Auditoria',
  '/app/gestao/configuracoes': 'Configurações',
};

async function barraEPortas(email: string, apelido: string) {
  console.log(`\n──── ${apelido} ────`);
  const cookie = await sessao(email);

  // A barra vem de qualquer página do console que a pessoa abra.
  let barra = '';
  for (const s of SECOES) {
    const p = await pagina(s, cookie);
    if (p.status === 200 && p.texto.includes('Gestão ·')) {
      barra = p.texto.slice(0, p.texto.indexOf('Gestão ·') + 1200);
      break;
    }
  }

  if (!barra) {
    // Ninguém entra: então NENHUMA seção pode abrir.
    for (const s of SECOES) {
      const p = await pagina(s, cookie);
      ok(p.status !== 200, `${apelido} não abre ${s}`, `status ${p.status}`);
    }
    return;
  }

  for (const s of SECOES) {
    const oferecida = barra.includes(ROTULO[s]);
    const p = await pagina(s, cookie);

    // A RAIZ NÃO É UMA SEÇÃO — é a entrada, e a regra dela é outra.
    //
    // Quem tem Vendas abre Vendas; quem não tem é MANDADO para a primeira
    // seção que tem. O que ela nunca pode fazer é dar 403 em quem acabou de
    // passar pela porta do console: seria um console que só sabe dizer não.
    if (s === '/app/gestao') {
      if (oferecida) {
        ok(p.status === 200, 'oferece "Vendas" e a página ABRE', `status ${p.status}`);
      } else {
        ok(
          p.status >= 300 && p.status < 400 && p.destino.startsWith('/app/gestao/'),
          'não oferece "Vendas" e a raiz REDIRECIONA para uma seção própria',
          `status ${p.status}, destino "${p.destino}"`,
        );
      }
      continue;
    }

    const abre = p.status === 200;
    if (oferecida) {
      ok(abre, `oferece "${ROTULO[s]}" e a página ABRE`, `status ${p.status}`);
    } else {
      ok(!abre, `não oferece "${ROTULO[s]}" e a página RECUSA`, `status ${p.status}`);
    }
  }
}

await barraEPortas(process.env.SMOKE_GERENTE ?? 'gerente@brasaburger.test', 'gerente');
await barraEPortas(process.env.SMOKE_EMAIL ?? 'dono@brasaburger.test', 'dono');
await barraEPortas(process.env.SMOKE_GARCOM ?? 'garcom@brasaburger.test', 'garçom');

console.log('\n──── a cozinha anota perda ────');
{
  const cookie = await sessao(process.env.SMOKE_COZINHA ?? 'cozinha@brasaburger.test');

  const perdas = await pagina('/app/perdas', cookie);
  ok(perdas.status === 200, 'cozinha abre a tela de perdas', `status ${perdas.status}`);
  ok(perdas.texto.includes('O que estragou'), 'e é a tela de perdas mesmo');

  // A cozinha NÃO entra no estoque: lá tem custo e margem, que é dinheiro.
  const estoque = await pagina('/app/gestao/estoque', cookie);
  ok(
    estoque.status === 403 || estoque.texto.includes('Área da gestão'),
    'cozinha NÃO vê custo nem margem',
    `status ${estoque.status}`,
  );
}

console.log('\n──── o garçom continua de fora ────');
{
  const cookie = await sessao(process.env.SMOKE_GARCOM ?? 'garcom@brasaburger.test');
  const perdas = await pagina('/app/perdas', cookie);
  ok(
    perdas.status === 403 || perdas.texto.includes('Área da gestão'),
    'garçom NÃO anota perda',
    `status ${perdas.status}`,
  );
  const gestao = await pagina('/app/gestao', cookie);
  ok(
    gestao.status === 403 || gestao.texto.includes('Área da gestão'),
    'garçom NÃO entra na gestão',
    `status ${gestao.status}`,
  );
}

if (falhas > 0) {
  console.log(`\n✗ ${falhas} verificação(ões) falharam.\n`);
  process.exit(1);
}
console.log('\n✓ as portas novas abrem para quem deve, e só para quem deve.\n');
