#!/usr/bin/env node
// ─── Worker de campanhas do Pedidos.IA ──────────────────────────────────────
// Roda na mesma máquina da Evolution, e não na Vercel. Não envia nada por
// conta própria: chama o tick e dorme o tempo que ele mandar.
//
// POR QUE AQUI E NÃO NUM CRON DA VERCEL
//
// O cron da Vercel tem granularidade de um minuto no plano Pro — e de um DIA
// no Hobby. Uma campanha de 200 pessoas, a uma mensagem por minuto, levaria
// três horas e meia; no Hobby, 200 dias. O tick devolve `emMs` justamente
// para quem chama respeitar o ritmo de 40 a 90 segundos, e só um processo
// vivo consegue obedecer a isso.
//
// E a máquina já existe: é a mesma que sustenta a Evolution.
//
// TODA A LÓGICA MORA NO APP
//
// Quem é o próximo, se ainda consente, qual o texto, o teto do dia — nada
// disso está aqui. Duplicar seria garantia de divergir do que a tela mostra
// na primeira vez que alguém mexesse num dos dois lados.
//
// Uso:
//   PEDIDOS_IA_URL=https://seu-app.vercel.app \
//   MARKETING_WORKER_SECRET=xxxxx \
//   node marketing-worker.mjs

const URL_BASE = (process.env.PEDIDOS_IA_URL || '').replace(/\/+$/, '');
const SECRET = process.env.MARKETING_WORKER_SECRET || '';
const TICK_URL = `${URL_BASE}/api/marketing/tick`;

// Quanto esperar quando o app não respondeu. Sobe a cada falha seguida para
// não martelar um servidor que já está em apuros, e volta ao normal no
// primeiro sucesso.
const ERRO_MIN_MS = 5_000;
const ERRO_MAX_MS = 5 * 60_000;
const TIMEOUT_MS = 90_000;

let falhasSeguidas = 0;
let rodando = true;

function log(nivel, msg, extra) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), nivel, msg, ...extra }));
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function backoff() {
  const base = Math.min(ERRO_MAX_MS, ERRO_MIN_MS * 2 ** (falhasSeguidas - 1));
  // Jitter: vários reinícios simultâneos não batem no mesmo instante.
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

async function tick() {
  const res = await fetch(TICK_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 401) {
    // Secret errado não se resolve com retry — melhor morrer e deixar o
    // supervisor reiniciar depois de alguém arrumar a variável.
    log('erro', 'Secret rejeitado (401). Confira MARKETING_WORKER_SECRET.');
    process.exit(1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  return res.json();
}

async function main() {
  if (!URL_BASE || !SECRET) {
    log('erro', 'Faltou PEDIDOS_IA_URL ou MARKETING_WORKER_SECRET.');
    process.exit(1);
  }

  // Confere URL e secret ANTES de entrar no laço: erro de configuração
  // aparece na hora, e não dali a horas quando alguém for disparar.
  try {
    const res = await fetch(TICK_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(20_000),
    });
    // 401 é o tropeço mais comum na instalação: secret diferente entre esta
    // máquina e a Vercel, ou a variável nem criada lá. Merece mensagem
    // própria, senão vira caça ao tesouro em cima de um "HTTP 401" seco.
    if (res.status === 401) {
      log('erro', 'Secret rejeitado (401). O MARKETING_WORKER_SECRET daqui precisa ser IDÊNTICO ao configurado na Vercel.');
      process.exit(1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const saude = await res.json().catch(() => ({}));
    log('info', 'Conectado ao app', { url: TICK_URL, whatsapp: saude.whatsapp });

    // O app diz se ELE enxerga a Evolution. Sem isso, o worker rodaria feliz
    // marcando destinatário como falho um por um, a cada 40 segundos.
    if (saude.whatsapp === false) {
      log('aviso', 'O app subiu SEM EVOLUTION_API_URL/KEY. Todo envio vai falhar até isso ser configurado na Vercel.');
    }
  } catch (e) {
    log('erro', `Não consegui falar com o app: ${e.message}`, { url: TICK_URL });
    process.exit(1);
  }

  while (rodando) {
    let esperar = 15_000;
    try {
      const r = await tick();
      falhasSeguidas = 0;
      esperar = Math.max(1_000, Number(r.emMs) || 15_000);

      const gatilhos = Object.entries(r.gatilhos ?? {})
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}:${n}`)
        .join(' ');

      // Só registra quando ACONTECEU algo. Um log por tick encheria o disco
      // com "nada a fazer" a cada 15 segundos, e esconderia o que importa.
      if (r.enviou || r.promovidas || gatilhos) {
        log('info', 'tick', {
          enviou: r.enviou,
          agendadasIniciadas: r.promovidas,
          gatilhos: gatilhos || undefined,
          proximoEmMs: esperar,
        });
      }
    } catch (e) {
      falhasSeguidas++;
      esperar = backoff();
      log('aviso', `Falha no tick: ${e.message}`, { falhasSeguidas, tentarEmMs: esperar });
    }
    await dormir(esperar);
  }
}

// O supervisor manda SIGTERM no stop/restart. Sair limpo evita derrubar o
// processo no meio de um envio — o tick em andamento termina antes.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    log('info', `${sinal} recebido, encerrando após o tick atual`);
    rodando = false;
    setTimeout(() => process.exit(0), TIMEOUT_MS + 5_000).unref();
  });
}

main().catch((e) => {
  log('erro', `Worker morreu: ${e.message}`);
  process.exit(1);
});
