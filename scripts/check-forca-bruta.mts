/**
 * §10.6 na prática: a senha pode ser testada à vontade?
 *
 * Pela porta REAL — o formulário de login, por HTTP, como um atacante faria.
 * Um teste de banco provaria que a função conta certo; não prova que a Server
 * Action chama a função, nem que ela chama ANTES de tocar no servidor de auth.
 *
 *     pnpm build && pnpm start &
 *     pnpm check:forca-bruta
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

/**
 * Descobre o campo da Server Action lendo o HTML da página.
 *
 * É assim que um atacante faria: o formulário de login é um `<form>` comum, com
 * `multipart/form-data`, e o identificador da action vai como NOME de um campo
 * oculto — em texto puro, na página que qualquer um abre.
 *
 * A primeira versão deste script mandava o id no header `Next-Action`, que é o
 * caminho do JavaScript. O servidor respondia "Connection closed", nada era
 * contado, e as asserções deram um resultado que parecia significar outra
 * coisa. Extrair do HTML mantém o teste válido quando o build troca o hash.
 */
async function campoDaAction(): Promise<string> {
  const html = await (await fetch(`${BASE}/app/entrar`)).text();
  const m = html.match(/name="(\$ACTION_ID_[0-9a-f]+)"/);
  if (!m) throw new Error('não achei o campo da Server Action de login no HTML');
  return m[1];
}

async function tentarLogin(campo: string, usuario: string, senha: string) {
  const corpo = new FormData();
  corpo.set(campo, '');
  corpo.set('de', '/app');
  corpo.set('usuario', usuario);
  corpo.set('senha', senha);

  const r = await fetch(`${BASE}/app/entrar`, {
    method: 'POST',
    body: corpo,
    redirect: 'manual',
  });

  const texto = await r.text();

  // O `redirect()` de dentro da action volta como cabeçalho ou como instrução
  // no corpo, conforme o caminho. Olhar os dois evita ler "não entrou" quando
  // na verdade entrou.
  const destino = r.headers.get('x-action-redirect') ?? r.headers.get('location') ?? '';
  const alvo = destino + texto;

  return {
    status: r.status,
    bloqueado: alvo.includes('espere=1'),
    entrou: !alvo.includes('erro=1') && /\/app(?![/\w]*entrar)/.test(alvo),
  };
}

const campo = await campoDaAction();
console.log(`campo da action: ${campo.slice(0, 24)}…`);

// Conta que existe, senha errada. É o cenário do ataque: o alvo é real.
const ALVO = 'garcom@brasaburger.test';

let bloqueouNa: number | null = null;

for (let i = 1; i <= 12; i++) {
  const r = await tentarLogin(campo, ALVO, `chute-numero-${i}`);
  if (r.bloqueado && bloqueouNa === null) bloqueouNa = i;
  console.log(
    `  tentativa ${String(i).padStart(2)}: ${r.bloqueado ? 'BLOQUEADO' : 'recusado (segue tentando)'}`,
  );
}

console.log('');

const falhas: string[] = [];

if (bloqueouNa === null) {
  falhas.push('12 chutes seguidos e nenhum bloqueio — a senha pode ser testada à vontade');
} else {
  console.log(`✓ bloqueou a partir da tentativa ${bloqueouNa}`);
}

// E a senha CERTA depois do bloqueio: precisa continuar barrada, senão o freio
// não freia nada — bastaria intercalar.
const depois = await tentarLogin(campo, ALVO, 'senha-de-teste-123');
if (depois.entrou) {
  falhas.push('a senha certa passou mesmo com o balde cheio — o freio não segura');
} else {
  console.log('✓ nem a senha certa passa enquanto o balde está cheio');
}

// Outra conta, mesma origem: o balde de CONTA não pode derrubar o sistema
// inteiro. Quarenta é o teto de origem, e doze chutes estão longe dele.
const outra = await tentarLogin(campo, 'caixa@brasaburger.test', 'senha-de-teste-123');
if (!outra.entrou) {
  falhas.push('outra conta foi bloqueada junto — o balde de conta virou balde global');
} else {
  console.log('✓ outra conta continua entrando normalmente');
}

console.log('');
if (falhas.length > 0) {
  for (const f of falhas) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ §10.6 — força bruta freada na porta real');
process.exit(0);
