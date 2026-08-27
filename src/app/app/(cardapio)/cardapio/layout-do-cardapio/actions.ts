'use server';

import { revalidatePath } from 'next/cache';

import { exigirPermissao } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';

/**
 * Blocos do cardápio (§12.10).
 *
 * Toda escrita passa por função do banco, que cobra `menu.structure` e mexe
 * SEMPRE no rascunho — publicar é um ato separado. Alterar o layout vigente
 * direto mudaria o cardápio no celular de quem está pedindo agora.
 */

export interface ResultadoBloco {
  ok: boolean;
  erro?: string;
}

async function rpc(
  nome: 'adicionar_bloco' | 'mover_bloco' | 'atualizar_bloco' | 'remover_bloco',
  args: Record<string, unknown>,
): Promise<ResultadoBloco> {
  await exigirPermissao('menu.structure');

  const supabase = await createClient();
  const { error } = await supabase.rpc(nome, args as never);

  if (error) return { ok: false, erro: error.message };

  revalidatePath('/app/cardapio/layout-do-cardapio');
  return { ok: true };
}

export async function adicionarBloco(
  tipo: string,
  config: Record<string, unknown> = {},
): Promise<ResultadoBloco> {
  return rpc('adicionar_bloco', { p_tipo: tipo, p_config: config });
}

export async function moverBloco(id: string, direcao: 'cima' | 'baixo'): Promise<ResultadoBloco> {
  return rpc('mover_bloco', { p_bloco: id, p_direcao: direcao });
}

export async function atualizarBloco(
  id: string,
  config?: Record<string, unknown>,
  oculto?: boolean,
): Promise<ResultadoBloco> {
  return rpc('atualizar_bloco', {
    p_bloco: id,
    p_config: config ?? null,
    p_oculto: oculto ?? null,
  });
}

export async function removerBloco(id: string): Promise<ResultadoBloco> {
  return rpc('remover_bloco', { p_bloco: id });
}

/** Publica o rascunho: é a partir daqui que o cliente vê a mudança. */
export async function publicarLayout(): Promise<ResultadoBloco> {
  await exigirPermissao('menu.publish');

  const supabase = await createClient();
  const { error } = await supabase.rpc('publish_menu_layout');

  if (error) return { ok: false, erro: error.message };

  revalidatePath('/app/cardapio/layout-do-cardapio');
  // O cardápio do cliente é `force-dynamic`, então não há cache a limpar — mas
  // a tela do editor precisa reler o estado de publicação.
  return { ok: true };
}
