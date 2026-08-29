'use server';

import { revalidatePath } from 'next/cache';

import { exigirPermissao } from '@/lib/auth/staff';
import { enviarPelaEvolution } from '@/lib/marketing/enviar';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * As ações da caixa de entrada.
 *
 * Enviar precisa de `service_role` para GRAVAR a mensagem — a 0062 não dá
 * policy de insert a ninguém, de propósito: com uma, a tela poderia forjar uma
 * mensagem "recebida" do cliente, e a conversa é registro do que aconteceu.
 *
 * A autorização, então, é inteiramente daqui: `exigirPermissao` antes de
 * qualquer coisa, e o `restaurant_id` sai da sessão. Isto é o oposto do resto
 * do sistema, onde quem recusa é o Postgres — está escrito para quem for mexer
 * saber que aqui a checagem em TypeScript É a fronteira.
 */

export interface ResultadoChat {
  ok: boolean;
  erro?: string;
}

const CAMINHO = '/app/gestao/conversas';

export async function enviarMensagem(jid: string, texto: string): Promise<ResultadoChat> {
  const corpo = texto.trim();
  if (corpo.length < 1) return { ok: false, erro: 'Escreva alguma coisa.' };
  if (corpo.length > 4096) return { ok: false, erro: 'A mensagem passou de 4096 caracteres.' };

  const staff = await exigirPermissao('chat.send');

  const supabase = await createClient();
  const { data: casa } = await supabase
    .from('restaurants')
    .select('evolution_instance_name')
    .eq('id', staff.restaurantId)
    .single();

  const instancia = casa?.evolution_instance_name ?? null;
  if (!instancia) return { ok: false, erro: 'Conecte o WhatsApp nas configurações.' };

  // O JID vem da tela, e é aqui que ele para de ser confiável: precisa ser uma
  // conversa QUE JÁ EXISTE nesta casa. Sem isto, um `jid` forjado no navegador
  // mandaria mensagem pelo número da casa para qualquer telefone do mundo.
  const { count } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('jid', jid);

  if (!count) return { ok: false, erro: 'Conversa não encontrada.' };

  const telefone = jid.replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
  const r = await enviarPelaEvolution({
    campanha: '',
    alvo: '',
    restaurante: staff.restaurantId,
    instancia,
    telefone,
    mensagem: corpo,
  });

  if (!r.ok) {
    console.error('[chat] envio falhou', { jid: jid.slice(0, 6) + '…', motivo: r.motivo, detalhe: r.detalhe });
    return { ok: false, erro: r.motivo };
  }

  // Gravada como `saida` sem `wa_id`: a Evolution devolve o id no corpo da
  // resposta, mas o webhook reentrega a mesma mensagem em `MESSAGES_UPSERT`
  // com `fromMe: true` — e é ele quem tem o id de verdade. Guardar um id
  // chutado aqui faria o upsert do webhook criar uma segunda linha.
  const admin = createAdminClient();
  const { error } = await admin.from('whatsapp_messages').insert({
    restaurant_id: staff.restaurantId,
    jid,
    direcao: 'saida',
    corpo,
    status: 'enviada',
  });

  if (error) {
    // A mensagem SAIU. Falhar a ação agora faria a pessoa mandar de novo.
    console.error('[chat] enviada mas não gravada', { erro: error.message });
  }

  revalidatePath(CAMINHO);
  return { ok: true };
}

export async function marcarLida(jid: string): Promise<ResultadoChat> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('marcar_conversa_lida', { p_jid: jid });
  if (error) return { ok: false, erro: 'Não deu para marcar como lida.' };
  revalidatePath(CAMINHO);
  return { ok: true };
}
