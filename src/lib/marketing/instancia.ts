import 'server-only';

/**
 * A CONEXÃO do WhatsApp: criar a instância, ver o estado, pegar o QR.
 *
 * Portado do `crm_beta_final` (`lib/evolution/manage.ts` e as rotas em
 * `app/api/evolution/`), que já faz isto em produção. O que veio de lá inteiro
 * é o conhecimento caro, o que só se aprende apanhando:
 *
 *  - o QR volta em três formatos diferentes conforme a versão e o momento da
 *    Evolution, e ler só um deles dá "conectado, mas sem QR na tela";
 *
 *  - recriar uma instância exige APAGAR e ESPERAR. O Baileys segura a sessão
 *    por um instante depois do delete, e criar em cima devolve uma instância
 *    que nasce quebrada;
 *
 *  - os ajustes da instância têm que estar aplicados ANTES do primeiro
 *    pareamento (§ `AJUSTES`).
 *
 * O QUE MUDOU, E POR QUÊ
 *
 * O CRM tem uma organização por servidor Evolution. Aqui o servidor é
 * COMPARTILHADO entre todos os restaurantes, e isso muda uma coisa de lugar:
 * o nome da instância deixa de ser um apelido e passa a ser a chave que separa
 * uma casa da outra. Ver `nomeDaInstancia`.
 */

/** A Evolution é lenta para criar e rápida para responder o resto. */
const TIMEOUT_MS = 15_000;

/**
 * O nome da instância, derivado — nunca digitado.
 *
 * O CRM faz `toInstanceName(organization.name)` e para por aí. Copiar isso aqui
 * seria um furo de multi-inquilino, não um detalhe de estilo: o servidor
 * Evolution é um só para todas as casas, e DUAS "Brasa Burger" produziriam o
 * mesmo `brasa_burger`. A segunda a conectar ou receberia o nome recusado, ou
 * — pior — passaria a disparar pelo número da primeira.
 *
 * Por isso o id do restaurante entra no nome. Os 8 primeiros caracteres do
 * UUID são suficientes para separar, e o pedaço legível continua na frente
 * porque quem lê o log da Evolution precisa saber de quem é a instância.
 *
 * O resultado só tem `[a-z0-9_]`, porque este valor vai para o CAMINHO de uma
 * URL: uma barra aqui viraria travessia de caminho na chamada.
 */
export function nomeDaInstancia(nome: string, restauranteId: string): string {
  const legivel = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);

  const sufixo = restauranteId.replace(/-/g, '').slice(0, 8);

  // Casa sem nome utilizável (só emoji, por exemplo) ainda precisa de instância.
  return legivel ? `${legivel}_${sufixo}` : `casa_${sufixo}`;
}

/**
 * OS AJUSTES DA INSTÂNCIA — e o momento em que eles param de ser mutáveis.
 *
 * Do comentário do CRM, que é a parte mais cara deste arquivo: quem decide
 * mandar o histórico completo é o WhatsApp, no PRIMEIRO pareamento, e essa
 * decisão acontece uma vez só. Depois de pareado não dá para voltar atrás sem
 * desconectar e ler o QR de novo. Então `/settings/set` vai ANTES do QR, sempre.
 *
 * `syncFullHistory` aqui é `false`, ao contrário do CRM — e é a única diferença
 * de valor entre os dois. Lá o produto é uma caixa de entrada, e o histórico é
 * o conteúdo. Aqui não se lê mensagem nenhuma: a base de quem pode receber é
 * construída por opt-in explícito (0049). Puxar a agenda inteira do aparelho
 * traria milhares de contatos que nunca autorizaram nada, para dentro de um
 * sistema cujo trabalho é justamente saber quem autorizou.
 *
 * `groupsIgnore` é `true` pelo mesmo motivo: grupo não é cliente.
 */
const AJUSTES = {
  rejectCall: false, // o cliente que ligar não leva porta na cara
  groupsIgnore: true,
  alwaysOnline: false,
  readMessages: false, // não marcamos como lida uma conversa que não lemos
  readStatus: false,
  syncFullHistory: false,
} as const;

interface Resposta {
  ok: boolean;
  status: number;
  corpo: Record<string, unknown>;
  /** Texto cru, só para o log do servidor. Nunca vai para a tela. */
  detalhe?: string;
}

/**
 * Uma chamada à Evolution.
 *
 * Nunca lança. A Evolution cai, demora e responde 500 com HTML, e um `throw`
 * aqui viraria tela de erro do Next em cima de um problema que a tela sabe
 * explicar melhor.
 */
async function evolution(
  metodo: 'GET' | 'POST' | 'DELETE',
  caminho: string,
  corpo?: unknown,
): Promise<Resposta> {
  const base = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const chave = process.env.EVOLUTION_API_KEY;

  if (!base || !chave) {
    return { ok: false, status: 0, corpo: {}, detalhe: 'EVOLUTION_API_URL/KEY ausentes' };
  }

  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { apikey: chave, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  }).catch(() => null);

  if (!r) return { ok: false, status: 0, corpo: {}, detalhe: 'sem resposta da Evolution' };

  const texto = await r.text().catch(() => '');
  let json: Record<string, unknown> = {};
  try {
    json = texto ? JSON.parse(texto) : {};
  } catch {
    // 502 do Caddy vem em HTML. Não é JSON e não é erro nosso.
  }

  return { ok: r.ok, status: r.status, corpo: json, detalhe: texto.slice(0, 300) };
}

export type Estado = 'conectado' | 'conectando' | 'desconectado' | 'inexistente' | 'indisponivel';

/**
 * Em que pé está a instância.
 *
 * `inexistente` e `desconectado` são coisas diferentes na tela: a primeira pede
 * "criar", a segunda pede "ler o QR de novo". A Evolution devolve 404 para a
 * primeira e `state: 'close'` para a segunda.
 */
export async function estadoDaInstancia(instancia: string): Promise<Estado> {
  const r = await evolution('GET', `/instance/connectionState/${encodeURIComponent(instancia)}`);

  if (r.status === 0) return 'indisponivel';
  if (r.status === 404) return 'inexistente';
  if (!r.ok) return 'indisponivel';

  const dentro = (r.corpo.instance ?? {}) as Record<string, unknown>;
  const estado = String(dentro.state ?? r.corpo.state ?? '');

  if (estado === 'open') return 'conectado';
  if (estado === 'connecting') return 'conectando';
  return 'desconectado';
}

/**
 * Cria a instância e aplica os ajustes — nesta ordem, e sem QR.
 *
 * `qrcode: false` de propósito: quem pede o QR é `conectar()`, num segundo
 * passo, DEPOIS dos ajustes estarem no lugar. Pedir o QR junto da criação é o
 * caminho curto que fecha a janela descrita em `AJUSTES`.
 */
export async function criarInstancia(instancia: string): Promise<{ ok: boolean; erro?: string }> {
  const criacao = await evolution('POST', '/instance/create', {
    instanceName: instancia,
    qrcode: false,
    integration: 'WHATSAPP-BAILEYS',
  });

  // 403 com "already in use" não é falha: é a instância já existir, que é o
  // estado desejado. Qualquer outro erro é.
  const jaExiste =
    criacao.status === 403 || /already in use|already exists/i.test(criacao.detalhe ?? '');

  if (!criacao.ok && !jaExiste) {
    console.error('[whatsapp] criação recusada', {
      instancia,
      status: criacao.status,
      detalhe: criacao.detalhe,
    });
    return { ok: false, erro: 'A Evolution recusou criar a conexão.' };
  }

  const ajustes = await evolution('POST', `/settings/set/${encodeURIComponent(instancia)}`, AJUSTES);

  if (!ajustes.ok) {
    // Falhar aqui é pior do que parece, e por isso é erro e não aviso: sem os
    // ajustes, um QR lido agora congela o comportamento errado para sempre.
    console.error('[whatsapp] ajustes recusados', {
      instancia,
      status: ajustes.status,
      detalhe: ajustes.detalhe,
    });
    return {
      ok: false,
      erro: 'A conexão foi criada mas os ajustes não. Não leia o QR ainda — tente de novo.',
    };
  }

  return { ok: true };
}

export interface Conexao {
  estado: Estado;
  /** PNG em base64, pronto para `<img src>`. */
  qr: string | null;
  /** O código de 8 dígitos, para quem não consegue ler o QR. */
  codigo: string | null;
  erro?: string;
}

/**
 * Pede o QR.
 *
 * Os três formatos de resposta vêm do CRM, e não são paranoia: a Evolution
 * muda a forma conforme a versão e conforme a instância já ter sido pareada
 * antes. Ler só `qrcode.base64` deixa a tela vazia sem dizer por quê.
 */
export async function conectar(instancia: string): Promise<Conexao> {
  const r = await evolution('GET', `/instance/connect/${encodeURIComponent(instancia)}`);

  if (r.status === 404) return { estado: 'inexistente', qr: null, codigo: null };
  if (!r.ok) {
    console.error('[whatsapp] connect recusado', {
      instancia,
      status: r.status,
      detalhe: r.detalhe,
    });
    return {
      estado: 'indisponivel',
      qr: null,
      codigo: null,
      erro: 'O servidor de WhatsApp não respondeu.',
    };
  }

  const c = r.corpo as Record<string, unknown>;
  const qrcode = (c.qrcode ?? {}) as Record<string, unknown>;
  const dentro = (c.instance ?? {}) as Record<string, unknown>;

  const qr = (qrcode.base64 ?? c.base64 ?? c.qr ?? null) as string | null;
  const codigo = (qrcode.pairingCode ?? c.pairingCode ?? null) as string | null;
  const estado = String(dentro.state ?? c.state ?? '');

  return {
    // Sem QR e sem estado costuma significar que já está pareado — a Evolution
    // simplesmente não devolve QR para instância aberta.
    estado: estado === 'open' ? 'conectado' : qr || codigo ? 'conectando' : 'conectado',
    qr: qr ? (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`) : null,
    codigo,
  };
}

/**
 * Apaga a instância e recria do zero.
 *
 * É o botão de "começar de novo", para quando a sessão azeda — e azeda: o
 * WhatsApp derruba o pareamento sozinho depois de uns dias de aparelho
 * desligado, e a instância fica num limbo que não conecta nem devolve QR.
 *
 * A ESPERA DE 4 SEGUNDOS É O PONTO. Vem do CRM, e é o que separa recriar de
 * criar em cima de uma sessão que o Baileys ainda não soltou. Sem ela a
 * instância nova nasce com o estado antigo e não pareia.
 */
export async function recriarInstancia(
  instancia: string,
): Promise<{ ok: boolean; erro?: string }> {
  await evolution('DELETE', `/instance/delete/${encodeURIComponent(instancia)}`);
  await new Promise((r) => setTimeout(r, 4000));
  return criarInstancia(instancia);
}

/**
 * Desliga: despareia o aparelho E remove a instância.
 *
 * A ORDEM IMPORTA, e as duas etapas existem por razões diferentes.
 *
 * O `logout` é o que tem consequência real: é ele que corta a sessão do
 * WhatsApp do dono. Vai primeiro porque é o que não pode falhar em silêncio.
 *
 * O `delete` é limpeza, e não é opcional num servidor compartilhado: sem ele
 * cada casa que já conectou uma vez deixa uma casca para trás, e o servidor
 * vai juntando nomes que ninguém sabe mais de quem são. Verificado depois de
 * o botão "Desligar" ter passado no teste e a instância ter continuado lá.
 */
export async function desconectar(instancia: string): Promise<void> {
  await evolution('DELETE', `/instance/logout/${encodeURIComponent(instancia)}`);
  await evolution('DELETE', `/instance/delete/${encodeURIComponent(instancia)}`);
}
