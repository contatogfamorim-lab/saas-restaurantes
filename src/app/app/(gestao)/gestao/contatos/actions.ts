'use server';

import { revalidatePath } from 'next/cache';

import { exigirPermissao } from '@/lib/auth/staff';
import { buscarContatos } from '@/lib/marketing/instancia';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Trazer a agenda do aparelho para dentro do sistema.
 *
 * O QUE ESTES CONTATOS NÃO SÃO
 *
 * Não são base de marketing. São a agenda de um celular: tem cliente, tem o
 * fornecedor de carne, tem parente. Nenhuma dessas pessoas autorizou receber
 * promoção, e a 0062 torna o engano impossível guardando-as em tabela própria
 * — `publico_de_marketing` só enxerga `customers` com opt-in.
 *
 * Escreve com `service_role` pelo mesmo motivo da caixa de entrada: a 0062 não
 * dá policy de insert a ninguém. A autorização é a linha do `exigirPermissao`.
 */

export interface ResultadoSync {
  ok: boolean;
  erro?: string;
  /** Quantos vieram da Evolution e couberam na regra. */
  quantos?: number;
}

/** As MESMAS regras do webhook — os dois caminhos não podem divergir. */
function ehPessoa(jid: string): boolean {
  if (!jid) return false;
  return !(jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter'));
}

function telefoneDoJid(jid: string): string | null {
  const d = jid
    .replace(/@s\.whatsapp\.net$/, '')
    .replace(/@lid$/, '')
    .replace(/:\d+$/, '')
    .replace(/\D/g, '');
  return /^[0-9]{8,15}$/.test(d) ? d : null;
}

export async function sincronizarContatos(): Promise<ResultadoSync> {
  const staff = await exigirPermissao('chat.view');

  const supabase = await createClient();
  const { data: casa } = await supabase
    .from('restaurants')
    .select('evolution_instance_name')
    .eq('id', staff.restaurantId)
    .single();

  const instancia = casa?.evolution_instance_name ?? null;
  if (!instancia) return { ok: false, erro: 'Conecte o WhatsApp nas configurações.' };

  const r = await buscarContatos(instancia);
  if (!r.ok) return { ok: false, erro: r.erro };

  const linhas = r.contatos
    .map((c) => {
      const jid = String(c.remoteJid ?? c.id ?? '');
      if (!jid || !ehPessoa(jid)) return null;

      const nome = String(c.pushName ?? c.name ?? '').trim().slice(0, 120);
      const foto =
        typeof c.profilePicUrl === 'string' && c.profilePicUrl.startsWith('http')
          ? c.profilePicUrl
          : null;

      return {
        restaurant_id: staff.restaurantId,
        jid,
        phone: telefoneDoJid(jid),
        nome: nome || null,
        foto_url: foto,
        visto_em: new Date().toISOString(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (linhas.length === 0) {
    // Zero não é erro, e a diferença importa: a agenda pode não ter vindo no
    // pareamento (`syncFullHistory` desligado na época) e a tela precisa dizer
    // isso em vez de "deu certo, 0 contatos".
    return { ok: true, quantos: 0 };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('whatsapp_contacts')
    .upsert(linhas, { onConflict: 'restaurant_id,jid' });

  if (error) {
    console.error('[contatos] upsert falhou', { erro: error.message });
    return { ok: false, erro: 'Não deu para guardar os contatos.' };
  }

  revalidatePath('/app/gestao/contatos');
  return { ok: true, quantos: linhas.length };
}
