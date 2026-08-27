import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { numeroDoWhatsApp } from './numero';

/**
 * O envio de UMA mensagem pela Evolution API.
 *
 * Portado do `crm_beta_final`, que já roda isto em produção. O que veio de lá
 * inteiro: o intervalo sorteado, a reserva antes do envio, e a regra de que a
 * resposta crua da Evolution nunca chega à tela do cliente.
 *
 * O QUE MUDOU
 *
 * O CRM montava o payload a partir de uma linha da fila que já trazia o
 * telefone. Aqui a fila NÃO tem telefone: quem entrega número, texto e
 * instância é `reservar_proximo_envio()`, uma função só, dentro de uma
 * transação, que antes de devolver qualquer coisa reconfere se a pessoa ainda
 * aceita receber.
 *
 * Isso não é elegância — é onde a regra fica difícil de furar. Se a
 * conferência morasse aqui, bastaria alguém escrever um segundo caminho de
 * envio para ela deixar de existir. Do jeito que está, o segundo caminho
 * também teria que passar pela função, ou não teria número para onde mandar.
 *
 * O QUE FALTA, E É PROPOSITAL
 *
 * Não há envio com imagem. O CRM de origem tem, e depende de um bucket privado
 * com URL assinada. Aqui isso ainda não existe, e meia implementação de mídia
 * seria pior que nenhuma: a campanha aceitaria a imagem e mandaria só o texto.
 */

const TIMEOUT_MS = 20_000;

export interface Envio {
  campanha: string;
  alvo: string;
  restaurante: string;
  instancia: string | null;
  telefone: string | null;
  mensagem: string;
}

export type Resultado =
  | { ok: true }
  | { ok: false; motivo: string; detalhe?: string };

/**
 * Manda pela Evolution. Devolve o motivo em português para a tela e o detalhe
 * técnico separado, que só vai para o log do servidor.
 */
export async function enviarPelaEvolution(envio: Envio): Promise<Resultado> {
  const base = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const chave = process.env.EVOLUTION_API_KEY;

  if (!base || !chave) {
    return { ok: false, motivo: 'WhatsApp não configurado no servidor' };
  }
  if (!envio.instancia) {
    return { ok: false, motivo: 'Este restaurante não conectou o WhatsApp' };
  }
  if (!envio.telefone) {
    return { ok: false, motivo: 'Cliente sem telefone' };
  }

  const numero = numeroDoWhatsApp(envio.telefone);
  if (!numero) {
    return { ok: false, motivo: 'Número de telefone inválido' };
  }

  const resposta = await fetch(
    `${base}/message/sendText/${encodeURIComponent(envio.instancia)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chave },
      body: JSON.stringify({ number: numero, text: envio.mensagem }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  ).catch(() => null);

  if (!resposta || !resposta.ok) {
    const cru = resposta
      ? await resposta.text().catch(() => '')
      : 'sem resposta da Evolution';
    return {
      // A tela do dono vê isto…
      ok: false,
      motivo: 'Não foi possível enviar agora',
      // …e só o log do servidor vê isto. Resposta crua de API externa pode
      // trazer estrutura interna, versão, e às vezes o próprio número.
      detalhe: cru.slice(0, 200),
    };
  }

  return { ok: true };
}

/**
 * Uma rodada: reserva um envio, manda, e registra o desfecho.
 *
 * Devolve `null` quando não havia nada a fazer — o que é o caso na esmagadora
 * maioria das chamadas, e não é erro.
 */
export async function rodadaDeEnvio(): Promise<{ campanha: string } | null> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('reservar_proximo_envio');
  if (error) throw new Error(`reserva falhou: ${error.message}`);

  const envio = (Array.isArray(data) ? data[0] : null) as Envio | null;
  if (!envio) return null;

  const r = await enviarPelaEvolution(envio);

  await admin.rpc('concluir_envio', {
    p_alvo: envio.alvo,
    p_ok: r.ok,
    p_erro: r.ok ? undefined : r.motivo,
  });

  if (!r.ok) {
    // Sem dado pessoal no log (§10.9): id do destinatário, nunca o número nem
    // o texto que foi para ele.
    console.error('[marketing] envio falhou', {
      alvo: envio.alvo,
      campanha: envio.campanha,
      motivo: r.motivo,
      detalhe: r.detalhe,
    });
  }

  return { campanha: envio.campanha };
}
