'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirPermissao, exigirStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import type { ResultadoKds } from '@/lib/cozinha/tipos';

/**
 * Ações do KDS (spec §6).
 *
 * Cada uma valida permissão aqui E de novo dentro da função SQL. Server Action
 * é endpoint HTTP público: esconder o botão não protege nada.
 */

const idDeItem = z.uuid();

export async function iniciarItem(itemId: string): Promise<ResultadoKds> {
  await exigirPermissao('kds.advance_item');
  if (!idDeItem.safeParse(itemId).success) return { ok: false, mensagem: 'Item inválido' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('kds_start_item', { p_item_id: itemId });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/cozinha');
  return { ok: true };
}

export async function itemPronto(itemId: string): Promise<ResultadoKds> {
  await exigirPermissao('kds.advance_item');
  if (!idDeItem.safeParse(itemId).success) return { ok: false, mensagem: 'Item inválido' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('kds_item_ready', { p_item_id: itemId });

  if (error) return { ok: false, mensagem: traduzir(error) };

  // O garçom precisa saber na hora que tem prato na passagem (spec §5)
  revalidatePath('/app/cozinha');
  revalidatePath('/app/salao');
  return { ok: true };
}

/**
 * "Acabou" (spec §6).
 *
 * Remover do cardápio é permissão à parte (`menu.availability`): a cozinha tem
 * por padrão, mas se o dono tiver revogado, o item ainda sai da fila — só não
 * some do cardápio da casa.
 */
export async function acabou(
  itemId: string,
  removerDoCardapio: boolean,
): Promise<ResultadoKds> {
  const staff = await exigirPermissao('kds.advance_item');
  if (!idDeItem.safeParse(itemId).success) return { ok: false, mensagem: 'Item inválido' };

  const podeRemover = can(staff, 'menu.availability') && removerDoCardapio;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('kds_out_of_stock', {
    p_item_id: itemId,
    p_marcar_indisponivel: podeRemover,
  });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/cozinha');
  revalidatePath('/app/salao');

  const r = data as { produto?: string; removido_do_cardapio?: boolean } | null;
  return {
    ok: true,
    mensagem: r?.removido_do_cardapio
      ? `${r.produto} saiu do cardápio de todas as mesas`
      : `${r?.produto ?? 'Item'} baixado, cardápio mantido`,
  };
}

/** Usada pela tela para saber se a pessoa pode tirar o produto do cardápio. */
export async function podeRemoverDoCardapio(): Promise<boolean> {
  const staff = await exigirStaff();
  return can(staff, 'menu.availability');
}

function traduzir(error: { code?: string; message?: string }): string {
  if (error.code === '45030') return error.message ?? 'Este item mudou de estado';
  if (error.code === '45031') return 'Sem permissão';

  // Erro não previsto: o detalhe fica no log do servidor. Mensagem crua do
  // Postgres entregaria nome de tabela e coluna a quem estiver sondando.
  console.error('[cozinha]', error);
  return 'Não foi possível. Tente de novo.';
}
