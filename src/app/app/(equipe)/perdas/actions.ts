'use server';

import { revalidatePath } from 'next/cache';

import { exigirPermissao } from '@/lib/auth/staff';
import { paraMilesimos } from '@/lib/estoque/unidades';
import { createClient } from '@/lib/supabase/server';

/**
 * Registrar perda.
 *
 * Uma ação só, e ela SÓ registra perda — o tipo é fixo aqui, não vem do
 * formulário. Deixar o navegador escolher o tipo daria a esta tela o poder de
 * fazer entrada e contagem, que é exatamente o que a separação de telas existe
 * para impedir (§10.1: o servidor não confia no cliente).
 */
export async function registrarPerda(
  insumoId: string,
  quantidade: string,
  motivo: string,
): Promise<{ ok: boolean; erro?: string }> {
  const valor = paraMilesimos(quantidade);
  if (valor === null || valor <= 0) {
    return { ok: false, erro: 'Digite quanto se perdeu' };
  }
  if (motivo.trim().length < 3) {
    // Perda sem motivo é um número que ninguém consegue explicar depois — e a
    // pergunta "por que sumiram 4 kg de queijo?" é a que esta tela existe para
    // responder.
    return { ok: false, erro: 'Diga o que aconteceu' };
  }

  await exigirPermissao('stock.waste');

  const supabase = await createClient();
  const { error } = await supabase.rpc('movimentar_estoque', {
    p_insumo: insumoId,
    p_kind: 'perda',
    p_delta: -valor,
    p_motivo: motivo.trim(),
  });

  if (error) {
    if (/42501|permission denied/i.test(error.message)) {
      return { ok: false, erro: 'Você não tem permissão para isso.' };
    }
    return { ok: false, erro: 'Não deu certo agora' };
  }

  revalidatePath('/app/perdas');
  revalidatePath('/app/gestao/estoque');
  return { ok: true };
}
