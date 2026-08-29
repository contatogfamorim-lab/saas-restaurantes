/**
 * A conexão do WhatsApp, contra a Evolution DE VERDADE.
 *
 * Não dá para testar isto com mock. O que quebra aqui não é a nossa lógica —
 * é a Evolution devolver o QR num campo diferente do esperado, ou aceitar a
 * criação e recusar os ajustes, ou responder 200 com corpo vazio. Todo defeito
 * desta camada que já apareceu no CRM de origem foi de formato de resposta.
 *
 * PULA SOZINHO quando `EVOLUTION_API_URL` está vazio, que é o caso da CI: este
 * script CRIA e APAGA instância num servidor compartilhado, e não é coisa para
 * rodar a cada push.
 *
 * O nome da instância de teste é fixo e marcado, e o script apaga no fim mesmo
 * quando falha no meio — uma instância órfã num servidor compartilhado é lixo
 * que ninguém mais reconhece como lixo.
 */
import {
  conectar,
  criarInstancia,
  estadoDaInstancia,
  nomeDaInstancia,
  recriarInstancia,
} from '../src/lib/marketing/instancia.ts';

const BASE = process.env.EVOLUTION_API_URL;
if (!BASE) {
  console.log('\n⊘ EVOLUTION_API_URL vazio — pulando (é o esperado na CI).\n');
  process.exit(0);
}

/** Marcado no nome para que qualquer um saiba que pode apagar. */
const TESTE = nomeDaInstancia('zz teste automatico', '00000000-0000-4000-8000-00000000dead');

let falhas = 0;
function ok(passou: boolean, descricao: string, detalhe = '') {
  if (passou) console.log(`  ✓ ${descricao}`);
  else {
    falhas++;
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

async function apagar() {
  await fetch(`${BASE!.replace(/\/+$/, '')}/instance/delete/${TESTE}`, {
    method: 'DELETE',
    headers: { apikey: process.env.EVOLUTION_API_KEY ?? '' },
  }).catch(() => {});
}

try {
  console.log(`\n──── contra ${BASE} ────`);
  console.log(`  instância de teste: ${TESTE}`);
  await apagar(); // resto de uma rodada anterior que tenha falhado feio

  console.log('\n──── criar ────');
  ok((await estadoDaInstancia(TESTE)) === 'inexistente', 'antes de criar, é `inexistente`');

  const criada = await criarInstancia(TESTE);
  ok(criada.ok, 'cria a instância e aplica os ajustes', criada.erro);

  // O QUE O `criarInstancia` PROMETE: os ajustes ficaram GRAVADOS. Sem esta
  // conferência, um `/settings/set` que responde 200 e ignora o corpo passaria
  // despercebido — e o defeito só apareceria depois do pareamento, quando já
  // não dá para corrigir sem ler o QR de novo.
  const ajustes = await fetch(
    `${BASE.replace(/\/+$/, '')}/settings/find/${TESTE}`,
    { headers: { apikey: process.env.EVOLUTION_API_KEY ?? '' } },
  ).then((r) => r.json()).catch(() => ({}));

  ok(ajustes.syncFullHistory === false, 'NÃO puxa o histórico do aparelho',
    `veio ${JSON.stringify(ajustes.syncFullHistory)}`);
  ok(ajustes.groupsIgnore === true, 'ignora grupos',
    `veio ${JSON.stringify(ajustes.groupsIgnore)}`);
  ok(ajustes.readMessages === false, 'não marca conversa como lida');

  console.log('\n──── estado e QR ────');
  const estado = await estadoDaInstancia(TESTE);
  ok(estado === 'desconectado' || estado === 'conectando',
    'depois de criada e antes de parear, não está conectada', `veio "${estado}"`);

  const conexao = await conectar(TESTE);
  ok(Boolean(conexao.qr), 'devolve um QR', conexao.erro ?? 'veio nulo');
  ok(
    conexao.qr?.startsWith('data:image/') ?? false,
    'o QR já vem pronto para <img src>',
    conexao.qr?.slice(0, 30),
  );

  console.log('\n──── recomeçar do zero ────');
  const refeita = await recriarInstancia(TESTE);
  ok(refeita.ok, 'apaga, espera o Baileys soltar, e recria', refeita.erro);
  ok(Boolean((await conectar(TESTE)).qr), 'a instância recriada devolve QR nova');

  console.log('\n──── desligar apaga mesmo ────');
  // O botão "Desligar" passou no teste de tela e a instância continuou de pé
  // no servidor. É o tipo de defeito que só aparece olhando o outro lado.
  const { desconectar } = await import('../src/lib/marketing/instancia.ts');
  await desconectar(TESTE);

  /*
   * ESPERAR, EM VEZ DE AFIRMAR NA HORA.
   *
   * A Evolution responde ao `delete` com 200 e "Instance deleted" ANTES de a
   * remoção ficar visível no `connectionState` — medido: a zero, 250 e 500ms
   * o estado ainda vinha 200; a partir de ~1s vinha 404, e aí some de vez (dez
   * segundos de sondagem depois, continuava 404).
   *
   * Ou seja: a resposta de sucesso é verdadeira e o `connectionState` é que
   * atrasa. Afirmar no milissegundo seguinte faria este check falhar de forma
   * intermitente — que é pior do que não ter check, porque ensina a ignorá-lo.
   *
   * Nada no produto depende disso: `desligarWhatsApp` apaga o nome no banco, e
   * a tela para de perguntar à Evolution a partir daí.
   */
  const sumiu = await (async () => {
    for (let i = 0; i < 15; i++) {
      if ((await estadoDaInstancia(TESTE)) === 'inexistente') return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  })();

  ok(sumiu, 'depois de desligar, a instância some do servidor', 'seis segundos depois ainda estava lá');

  console.log('\n──── nome inexistente ────');
  ok(
    (await estadoDaInstancia('zz_nao_existe_mesmo_00000000')) === 'inexistente',
    'instância que não existe é `inexistente`, e não `desconectado`',
  );
} finally {
  await apagar();
  console.log('\n  (instância de teste apagada)');
}

if (falhas > 0) {
  console.log(`\n✗ ${falhas} verificação(ões) falharam.\n`);
  process.exit(1);
}
console.log('\n✓ a conexão do WhatsApp funciona contra a Evolution de verdade.\n');
