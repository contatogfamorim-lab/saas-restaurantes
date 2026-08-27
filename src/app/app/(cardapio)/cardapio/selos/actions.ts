'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirPermissao } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';

/**
 * Selos do cardápio (§12).
 *
 * Escreve DIRETO na tabela, e não por função: `product_badges` tem policy de
 * escrita para quem tem `menu.content`, e a RLS já é a autorização. Função só
 * se justifica quando há regra que a policy não expressa — aqui não há.
 *
 * O que o banco garante e este arquivo não precisa repetir: slug único por
 * casa, cor hexadecimal, animação da lista fechada, selo interno que não se
 * apaga, e selo em uso que não se apaga.
 */

export interface ResultadoSelo {
  ok: boolean;
  erro?: string;
}

const selo = z.object({
  label: z.string().trim().min(2, 'Nome muito curto').max(18, 'No máximo 18 caracteres'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida'),
  animation: z.enum(['none', 'pulse', 'shine', 'bounce']),
});

/** Deriva o slug do rótulo: "Sem Glúten" → "sem_gluten". */
function slugificar(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

export async function criarSelo(formData: FormData): Promise<ResultadoSelo> {
  const parsed = selo.safeParse({
    label: formData.get('label'),
    color: formData.get('color'),
    animation: formData.get('animation'),
  });

  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const staff = await exigirPermissao('menu.content');
  const slug = slugificar(parsed.data.label);

  if (slug.length < 2) {
    return { ok: false, erro: 'Use ao menos duas letras ou números' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('product_badges').insert({
    restaurant_id: staff.restaurantId,
    slug,
    label: parsed.data.label.toUpperCase(),
    color: parsed.data.color,
    animation: parsed.data.animation,
    sort_order: 100,
  });

  if (error) {
    if (error.code === '23505') return { ok: false, erro: 'Já existe um selo com esse nome' };
    return { ok: false, erro: error.message };
  }

  revalidatePath('/app/cardapio/selos');
  return { ok: true };
}

export async function editarSelo(id: string, formData: FormData): Promise<ResultadoSelo> {
  const parsed = selo.safeParse({
    label: formData.get('label'),
    color: formData.get('color'),
    animation: formData.get('animation'),
  });

  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  await exigirPermissao('menu.content');

  const supabase = await createClient();
  // O SLUG NÃO MUDA na edição: ele está gravado nos produtos, e renomeá-lo
  // deixaria todos eles apontando para um selo que não existe mais.
  const { error } = await supabase
    .from('product_badges')
    .update({
      label: parsed.data.label.toUpperCase(),
      color: parsed.data.color,
      animation: parsed.data.animation,
    })
    .eq('id', id);

  if (error) return { ok: false, erro: error.message };

  revalidatePath('/app/cardapio/selos');
  return { ok: true };
}

export async function alternarSelo(id: string, ativo: boolean): Promise<ResultadoSelo> {
  await exigirPermissao('menu.content');

  const supabase = await createClient();
  const { error } = await supabase.from('product_badges').update({ active: ativo }).eq('id', id);

  if (error) return { ok: false, erro: error.message };

  revalidatePath('/app/cardapio/selos');
  return { ok: true };
}

export async function apagarSelo(id: string): Promise<ResultadoSelo> {
  await exigirPermissao('menu.content');

  const supabase = await createClient();
  const { error } = await supabase.from('product_badges').delete().eq('id', id);

  // As duas recusas do banco chegam aqui com mensagem pronta: selo do sistema e
  // selo em uso. Repeti-las em TypeScript seria manter a mesma regra em dois
  // lugares para ela divergir depois.
  if (error) return { ok: false, erro: error.message };

  revalidatePath('/app/cardapio/selos');
  return { ok: true };
}
