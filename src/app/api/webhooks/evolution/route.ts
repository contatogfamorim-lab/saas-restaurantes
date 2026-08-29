import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * O que a Evolution manda quando algo acontece no WhatsApp da casa.
 *
 * Portado de `crm_beta_final/app/api/webhooks/evolution`. Quatro eventos
 * interessam: a conexão mudou de estado, a agenda chegou, mensagem entrou,
 * mensagem mudou de status.
 *
 * ESTA ROTA ESCREVE COM `service_role`, ou seja, SEM RLS. É a única do sistema
 * assim, e por isso a autorização dela é o assunto mais importante do arquivo —
 * ver `autorizado()`. Um furo aqui é escrita cross-tenant aberta na internet.
 *
 * Responde 200 quase sempre, de propósito: a Evolution reentrega o que falha, e
 * uma mensagem malformada reentregue para sempre vira um laço que enche o log e
 * atrasa as mensagens boas. O que não deu para processar fica registrado no log
 * do servidor e sai da fila.
 */

export const dynamic = 'force-dynamic';

/**
 * O corpo que a Evolution manda.
 *
 * É `any`, e a regra que substitui o compilador está aqui: NADA sai deste
 * arquivo sem passar por `String()`, `Number()` ou `Boolean()`, e o banco
 * recusa o que escapar (`corpo` tem `check length between 1 and 4096`,
 * `direcao` e `status` são enums).
 *
 * `Record<string, unknown>` seria mais honesto e exigiria um `as` em cada nível
 * de `msg.extendedTextMessage?.text` — cinco níveis, quatro campos, e cada
 * `as` mentiria igual. O formato muda entre versões da Evolution; é a razão de
 * `conteudo()` procurar o texto em quatro lugares diferentes.
 */
type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Grupo, lista de transmissão e canal não são conversa com cliente. */
function ehPessoa(jid: string): boolean {
  if (!jid) return false;
  return !(
    jid.includes('@g.us') ||
    jid.includes('@broadcast') ||
    jid.includes('@newsletter')
  );
}

function telefoneDoJid(jid: string): string | null {
  const digitos = jid
    .replace(/@s\.whatsapp\.net$/, '')
    .replace(/@lid$/, '')
    .replace(/:\d+$/, '')
    .replace(/\D/g, '');
  return /^[0-9]{8,15}$/.test(digitos) ? digitos : null;
}

/**
 * O texto da mensagem, qualquer que seja o formato.
 *
 * A lista de campos vem do CRM e não é arbitrária: o WhatsApp embrulha o mesmo
 * texto em `conversation`, `extendedTextMessage` ou na legenda de uma mídia,
 * conforme o cliente que enviou.
 *
 * Mídia NÃO é baixada. O corpo fica `[audio]` e a tela mostra assim — meia
 * implementação seria pior, porque a conversa pareceria completa sem estar.
 */
function conteudo(msg: Payload): {
  corpo: string | null;
  midia: string | null;
} {
  const midia = msg.imageMessage
    ? 'image'
    : msg.audioMessage || msg.pttMessage
      ? 'audio'
      : msg.videoMessage
        ? 'video'
        : msg.documentMessage
          ? 'document'
          : msg.stickerMessage
            ? 'sticker'
            : null;

  const corpo =
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    (midia ? `[${midia}]` : null) ||
    null;

  return { corpo: corpo ? String(corpo).slice(0, 4096) : null, midia };
}

/** Mensagem de dispositivo/efêmera vem embrulhada mais uma vez. */
function desembrulhar(m: Payload | null | undefined): Payload {
  if (!m) return {};
  return (
    m.ephemeralMessage?.message ??
    m.viewOnceMessage?.message ??
    m.viewOnceMessageV2?.message ??
    m.documentWithCaptionMessage?.message ??
    m
  );
}

/**
 * O IP de quem chamou — UM, e o que o proxy apurou.
 *
 * O começo do `x-forwarded-for` é escrito por quem faz a requisição. Aceitar
 * qualquer elemento da lista (um `.some()`) deixaria qualquer pessoa entrar
 * mandando `x-forwarded-for: <ip-da-evolution>`. O CRM teve exatamente esse
 * furo, e aqui ele seria pior: esta rota grava sem RLS.
 */
function ipDeOrigem(req: Request): string {
  const vercel = req.headers.get('x-vercel-forwarded-for')?.trim();
  if (vercel) return vercel;

  const xff = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff.length) return xff[xff.length - 1];

  return req.headers.get('x-real-ip')?.trim() || 'desconhecido';
}

/**
 * Quem pode escrever aqui.
 *
 * Duas provas, e basta uma: a chave da Evolution no cabeçalho, ou o IP dela.
 * FECHA POR OMISSÃO — sem nada configurado, ninguém entra. O contrário
 * (abrir quando não há o que conferir) é como este tipo de endpoint costuma
 * acabar exposto.
 */
function autorizado(req: Request): boolean {
  const esperada = process.env.EVOLUTION_API_KEY;
  const veio = req.headers.get('apikey') ?? req.headers.get('x-api-key');

  // Comparação de tamanho fixo: `===` em string vaza o tamanho do prefixo comum
  // pelo tempo. É barato fazer certo.
  if (esperada && veio && veio.length === esperada.length) {
    let diff = 0;
    for (let i = 0; i < esperada.length; i++) {
      diff |= esperada.charCodeAt(i) ^ veio.charCodeAt(i);
    }
    if (diff === 0) return true;
  }

  const permitidos = new Set<string>();
  for (const ip of (process.env.EVOLUTION_WEBHOOK_IPS ?? '').split(',')) {
    if (ip.trim()) permitidos.add(ip.trim());
  }
  /*
   * O host da EVOLUTION_API_URL só entra se ELE MESMO for um IP.
   *
   * O CRM adiciona o hostname direto nesta lista, e a lista é comparada com um
   * IP — então para qualquer endereço com nome (o nosso é `…sslip.io`) a
   * entrada nunca casa. É código morto que PARECE uma segunda camada.
   *
   * Resolver o nome aqui seria pior: uma consulta DNS por requisição, e um
   * atacante que controle a resolução passa a decidir quem entra. Quem quiser
   * a camada de IP põe o IP em `EVOLUTION_WEBHOOK_IPS`.
   */
  try {
    const host = new URL(process.env.EVOLUTION_API_URL ?? '').hostname;
    if (/^[0-9.]+$/.test(host) || host.includes(':')) permitidos.add(host);
  } catch {
    // URL ausente ou inválida: sobra a lista explícita, que pode estar vazia.
  }

  if (permitidos.size === 0) return false;
  return permitidos.has(ipDeOrigem(req));
}

const STATUS_DA_EVOLUTION: Record<number, string> = {
  0: 'erro',
  1: 'pendente',
  2: 'enviada',
  3: 'entregue',
  4: 'lida',
};

export async function POST(req: Request) {
  if (!autorizado(req)) {
    // O IP entra no log porque é o dado que resolve o chamado quando a
    // Evolution sai por um IP diferente do esperado.
    console.warn('[webhook] recusado', { ip: ipDeOrigem(req) });
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  }

  let corpo: Payload;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const instancia = String(corpo.instance ?? corpo.instanceName ?? '');
  if (!instancia) return NextResponse.json({ ok: true });

  const admin = createAdminClient();

  const { data: casa } = await admin.rpc('casa_da_instancia', {
    p_instancia: instancia,
  });
  if (!casa) {
    console.warn('[webhook] instância sem casa', { instancia });
    return NextResponse.json({ ok: true });
  }
  const restaurante = casa as string;

  const evento = String(corpo.event ?? '').toUpperCase().replace(/\./g, '_');

  try {
    if (evento === 'CONNECTION_UPDATE') {
      // Só registra. Derrubar `evolution_instance_name` aqui apagaria a conexão
      // por causa de uma oscilação de rede — e o WhatsApp oscila.
      console.info('[webhook] conexão', {
        instancia,
        estado: corpo.data?.state ?? corpo.state,
      });
      return NextResponse.json({ ok: true });
    }

    if (evento.startsWith('CONTACTS_')) {
      await guardarContatos(admin, restaurante, corpo.data);
      return NextResponse.json({ ok: true });
    }

    if (evento === 'MESSAGES_UPDATE') {
      const chave = corpo.data?.key ?? corpo.key;
      const codigo = corpo.data?.update?.status ?? corpo.update?.status;
      const novo = STATUS_DA_EVOLUTION[Number(codigo)];
      if (chave?.id && novo) {
        await admin
          .from('whatsapp_messages')
          .update({
            status: novo,
            ...(novo === 'lida' ? { lida_em: new Date().toISOString() } : {}),
          })
          .eq('restaurant_id', restaurante)
          .eq('wa_id', String(chave.id));
      }
      return NextResponse.json({ ok: true });
    }

    if (evento === 'MESSAGES_UPSERT') {
      const dados = corpo.data;
      const lista = Array.isArray(dados) ? dados : dados?.key ? [dados] : [];
      await guardarMensagens(admin, restaurante, lista);
      return NextResponse.json({ ok: true });
    }
  } catch (erro) {
    // Sem dado pessoal no log (§10.9): o que houve, de que instância, e mais nada.
    console.error('[webhook] falhou', {
      instancia,
      evento,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }

  return NextResponse.json({ ok: true });
}

type Admin = ReturnType<typeof createAdminClient>;

async function guardarContatos(admin: Admin, restaurante: string, dados: unknown) {
  const lista = Array.isArray(dados) ? dados : dados ? [dados] : [];

  const linhas = lista
    .map((c: Payload) => {
      const jid = String(c.remoteJid ?? c.id ?? '');
      if (!jid || !ehPessoa(jid)) return null;

      const nome = String(c.pushName ?? c.name ?? '').trim().slice(0, 120);
      const foto = typeof c.profilePicUrl === 'string' && c.profilePicUrl.startsWith('http')
        ? c.profilePicUrl
        : null;

      return {
        restaurant_id: restaurante,
        jid,
        phone: telefoneDoJid(jid),
        nome: nome || null,
        foto_url: foto,
        visto_em: new Date().toISOString(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!linhas.length) return;

  const { error } = await admin
    .from('whatsapp_contacts')
    .upsert(linhas, { onConflict: 'restaurant_id,jid' });

  if (error) throw new Error(`contatos: ${error.message}`);
}

async function guardarMensagens(
  admin: Admin,
  restaurante: string,
  lista: Payload[],
) {
  const linhas = lista
    .map((m) => {
      const jid = String(m.key?.remoteJid ?? '');
      if (!jid || !ehPessoa(jid)) return null;

      const { corpo, midia } = conteudo(desembrulhar(m.message));
      if (!corpo) return null;

      // `fromMe` diz quem mandou. Sem ele, uma mensagem que a própria casa
      // enviou pelo celular apareceria como se o cliente tivesse escrito.
      const daCasa = Boolean(m.key?.fromMe);

      // O relógio vem em segundos. `messageTimestamp` pode vir como objeto
      // `{low, high}` em algumas versões — daí o `Number(...)` defensivo.
      const seg = Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0);
      const quando = seg > 0 ? new Date(seg * 1000) : new Date();

      return {
        restaurant_id: restaurante,
        jid,
        direcao: daCasa ? 'saida' : 'entrada',
        corpo,
        tipo_midia: midia,
        wa_id: m.key?.id ? String(m.key.id) : null,
        status: daCasa ? 'enviada' : 'recebida',
        enviada_em: quando.toISOString(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!linhas.length) return;

  // `ignoreDuplicates` porque a Evolution REENTREGA o mesmo evento quando
  // demoramos a responder. Sem isto, a conversa ganharia a mesma mensagem
  // duas vezes toda vez que o servidor engasgasse.
  const { error } = await admin
    .from('whatsapp_messages')
    .upsert(linhas, { onConflict: 'restaurant_id,wa_id', ignoreDuplicates: true });

  if (error) throw new Error(`mensagens: ${error.message}`);
}
