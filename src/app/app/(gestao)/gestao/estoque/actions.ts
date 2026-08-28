'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirPermissao } from '@/lib/auth/staff';
import { paraCentavos, paraMilesimos } from '@/lib/estoque/unidades';
import { createClient } from '@/lib/supabase/server';

/**
 * As ações do estoque.
 *
 * Nenhuma escreve em `ingredients` ou `stock_movements` direto — nem poderia:
 * as duas tabelas não têm policy de escrita para ninguém. Tudo passa pelas
 * funções do banco, que gravam saldo e extrato na mesma transação.
 *
 * É essa amarração que mantém o extrato honesto. Um caminho que atualizasse o
 * saldo sem gravar a linha criaria um número que ninguém consegue explicar — e
 * "por que sumiram 4 kg de queijo?" é a primeira pergunta que aparece.
 */

interface Resultado {
  ok: boolean;
  erro?: string;
  saldo?: number;
}

const CAMINHO = '/app/gestao/estoque';

function emPortugues(mensagem: string): string {
  if (/42501|permission denied|row-level security/i.test(mensagem)) {
    return 'Você não tem permissão para isso.';
  }
  if (/45130/.test(mensagem)) return 'Insumo não encontrado.';
  if (/45131/.test(mensagem)) return 'Já existe um insumo com esse nome.';
  const limpa = mensagem.replace(/^.*?:\s*/, '').trim();
  return limpa.length > 0 && limpa.length < 160 ? limpa : 'Não deu certo.';
}

const insumo = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto').max(80),
  unidade: z.enum(['g', 'ml', 'un']),
  minimo: z.string().default('0'),
  // Reais por quilo/litro/mil unidades. Vira centavos aqui.
  custo: z.string().default('0'),
});

export async function criarInsumo(formData: FormData): Promise<Resultado> {
  const parsed = insumo.safeParse({
    nome: formData.get('nome') ?? '',
    unidade: formData.get('unidade') ?? 'g',
    minimo: formData.get('minimo') ?? '0',
    custo: formData.get('custo') ?? '0',
  });
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const minimo = paraMilesimos(parsed.data.minimo || '0');
  if (minimo === null || minimo < 0) {
    return { ok: false, erro: 'Mínimo inválido' };
  }

  // A autorização de verdade está na função do banco, que cobra o papel. Esta
  // linha existe para a recusa chegar como frase em vez de erro de Postgres.
  await exigirPermissao('stock.manage');

  const supabase = await createClient();
  const { error } = await supabase.rpc('criar_insumo', {
    p_nome: parsed.data.nome,
    p_unidade: parsed.data.unidade,
    p_minimo: minimo,
    p_custo: paraCentavos(parsed.data.custo || '0'),
  });

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true };
}

export async function editarInsumo(id: string, formData: FormData): Promise<Resultado> {
  const nome = String(formData.get('nome') ?? '').trim();
  const minimo = paraMilesimos(String(formData.get('minimo') ?? '0'));
  const custo = paraCentavos(String(formData.get('custo') ?? '0'));

  if (nome.length < 2) return { ok: false, erro: 'Nome muito curto' };
  if (minimo === null || minimo < 0) return { ok: false, erro: 'Mínimo inválido' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('editar_insumo', {
    p_insumo: id,
    p_nome: nome,
    p_minimo: minimo,
    p_custo: custo,
  });

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true };
}

/**
 * Entrada, perda e contagem.
 *
 * A tela manda a quantidade sempre POSITIVA e o tipo separado; o sinal é
 * decidido aqui. Pedir para a pessoa digitar "-500" para uma perda é pedir para
 * ela errar o sinal — e um sinal errado numa perda vira entrada.
 *
 * A contagem é a exceção: ela não é um delta, é um SALDO. A pessoa conta o que
 * tem na prateleira e digita esse número; a diferença é que vira movimento.
 * Perguntar "quanto sobrou a mais ou a menos?" seria pedir que ela fizesse a
 * subtração — e é justamente a subtração que ela está ali para conferir.
 */
export async function movimentar(
  id: string,
  tipo: 'entrada' | 'perda' | 'contagem',
  quantidade: string,
  motivo: string,
  saldoAtual: number,
): Promise<Resultado> {
  const valor = paraMilesimos(quantidade);
  if (valor === null) return { ok: false, erro: 'Quantidade inválida' };
  if (valor < 0) return { ok: false, erro: 'Digite um número positivo' };
  if (valor === 0 && tipo !== 'contagem') {
    return { ok: false, erro: 'Quantidade não pode ser zero' };
  }

  const delta =
    tipo === 'entrada' ? valor : tipo === 'perda' ? -valor : valor - saldoAtual;

  if (delta === 0) {
    // Contagem que bate com o sistema é uma boa notícia, não um erro — e não é
    // movimento, porque nada mudou.
    return { ok: true, saldo: saldoAtual };
  }

  if (tipo === 'perda' && valor > 0 && saldoAtual - valor < 0) {
    // Não bloqueia: registra. Perder mais do que o sistema achava que tinha é
    // exatamente o caso em que o número precisa aparecer negativo, para alguém
    // ir contar.
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('movimentar_estoque', {
    p_insumo: id,
    p_kind: tipo === 'contagem' ? 'ajuste' : tipo,
    p_delta: delta,
    // `undefined` e não `null`: o tipo gerado declara o parâmetro opcional
    // como `string | undefined`, e o DEFAULT da função no banco já resolve a
    // ausência. É a mesma pegadinha do `cadastrar_cliente` na 0038.
    p_motivo: motivo.trim() || undefined,
  });

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  revalidatePath('/app/cardapio');
  return { ok: true, saldo: Number(data) };
}

/** Uma linha da ficha técnica: quanto deste insumo vai em uma porção. */
export async function salvarNaFicha(
  produtoId: string,
  insumoId: string,
  quantidade: string,
): Promise<Resultado> {
  const valor = paraMilesimos(quantidade);
  if (valor === null || valor <= 0) {
    return { ok: false, erro: 'Quantidade precisa ser maior que zero' };
  }

  const supabase = await createClient();
  const { data: perfil } = await supabase
    .from('ingredients')
    .select('restaurant_id')
    .eq('id', insumoId)
    .maybeSingle();

  if (!perfil) return { ok: false, erro: 'Insumo não encontrado.' };

  // `upsert` pela chave única (produto, insumo): mexer na receita é editar o
  // número, não empilhar linhas.
  const { error } = await supabase.from('product_ingredients').upsert(
    {
      restaurant_id: perfil.restaurant_id,
      product_id: produtoId,
      ingredient_id: insumoId,
      quantidade: valor,
    },
    { onConflict: 'product_id,ingredient_id' },
  );

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true };
}

export async function removerDaFicha(
  produtoId: string,
  insumoId: string,
): Promise<Resultado> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('product_ingredients')
    .delete()
    .eq('product_id', produtoId)
    .eq('ingredient_id', insumoId);

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true };
}
