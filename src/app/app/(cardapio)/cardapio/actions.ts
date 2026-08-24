'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';
import { canOpenMenuEditor } from '@/lib/permissions';

/**
 * Escrita do editor de cardápio (spec §12).
 *
 * DUAS REGRAS QUE ATRAVESSAM O ARQUIVO INTEIRO
 *
 * 1. Server Action é endpoint HTTP público. Esconder o campo no formulário não
 *    protege nada — cada função aqui revalida por conta própria, e a decisão
 *    fina de qual COLUNA cada permissão libera acontece no banco, no
 *    `products_column_guard`.
 *
 * 2. Tudo pelo client autenticado. `createClient()` carrega a sessão do
 *    funcionário; `createAdminClient()` não aparece neste arquivo de propósito,
 *    porque sob service_role o guard de coluna desiste (`auth.uid()` é nulo) e
 *    a separação entre preço, conteúdo e disponibilidade sumiria em silêncio.
 *
 * O erro do Postgres volta como texto para a tela. As mensagens do guard são
 * escritas para serem lidas por gente ("Sem permissão menu.price para alterar
 * o preço de X"), então repassar é melhor que traduzir para um genérico.
 */

export interface ResultadoDaEdicao {
  ok: boolean;
  erro?: string;
}

/** Todo mundo que entra aqui precisa ter ALGUMA permissão de cardápio. */
async function exigirEditor() {
  const staff = await exigirStaff();
  if (!canOpenMenuEditor(staff)) {
    throw new Error('Sem permissão para abrir o editor de cardápio');
  }
  return staff;
}

function falha(err: unknown): ResultadoDaEdicao {
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, erro: msg };
}

// ---------------------------------------------------------------------------
// PRODUTO
// ---------------------------------------------------------------------------

const precoEmReais = z
  .string()
  .trim()
  .regex(/^\d{1,6}([.,]\d{1,2})?$/, 'Preço inválido')
  .transform((v) => {
    // Centavos, integer, sempre (spec P2). `Math.round` sobre float faria
    // 19.99 * 100 virar 1998.9999999999998 — e um centavo perdido por item é
    // um relatório que não fecha no fim do mês.
    const [inteiros, decimais = ''] = v.replace(',', '.').split('.');
    return Number(inteiros) * 100 + Number(decimais.padEnd(2, '0'));
  });

const edicao = z.object({
  id: z.uuid(),
  nome: z.string().trim().min(1, 'O nome não pode ficar vazio').max(120),
  descricao: z.string().trim().max(500).nullable(),
  preco: precoEmReais,
  // NOT NULL no banco, com default 15: aceitar null aqui daria erro de
  // constraint depois de a pessoa já ter digitado o resto.
  prepMinutos: z.coerce.number().int().min(0).max(240),
  categoriaId: z.uuid(),
});

export async function salvarProduto(formData: FormData): Promise<ResultadoDaEdicao> {
  try {
    await exigirEditor();

    const bruto = {
      id: formData.get('id'),
      nome: formData.get('nome'),
      descricao: (formData.get('descricao') as string | null)?.trim() || null,
      preco: formData.get('preco'),
      prepMinutos: formData.get('prepMinutos') || 0,
      categoriaId: formData.get('categoriaId'),
    };

    const parsed = edicao.safeParse(bruto);
    if (!parsed.success) {
      return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
    }

    const supabase = await createClient();

    // O UPDATE manda TODAS as colunas editáveis, inclusive as que não mudaram.
    // O guard compara `new` com `old` e só cobra permissão do que de fato
    // mudou, então mandar o campo igual não exige nada — e assim a Action não
    // precisa adivinhar quais permissões quem chamou tem. Quem decide é o banco.
    const { error } = await supabase
      .from('products')
      .update({
        name: parsed.data.nome,
        description: parsed.data.descricao,
        price_cents: parsed.data.preco,
        prep_minutes: parsed.data.prepMinutos,
        category_id: parsed.data.categoriaId,
      })
      .eq('id', parsed.data.id);

    if (error) return { ok: false, erro: error.message };

    revalidatePath('/app/cardapio');
    revalidatePath(`/app/cardapio/${parsed.data.id}`);
    return { ok: true };
  } catch (err) {
    return falha(err);
  }
}

const criacao = z.object({
  nome: z.string().trim().min(1, 'O nome não pode ficar vazio').max(120),
  categoriaId: z.uuid('Escolha uma categoria'),
  preco: precoEmReais,
});

/**
 * Cria um item.
 *
 * Nasce INDISPONÍVEL de propósito. O padrão da coluna é `true`, o que faz
 * sentido para o seed, mas aqui significaria um item aparecendo no celular do
 * cliente no instante em que alguém aperta "criar" — antes da foto, antes da
 * descrição, às vezes antes do preço certo.
 */
export async function criarProduto(formData: FormData): Promise<ResultadoDaEdicao & { id?: string }> {
  try {
    await exigirEditor();

    const parsed = criacao.safeParse({
      nome: formData.get('nome'),
      categoriaId: formData.get('categoriaId'),
      preco: formData.get('preco') || '0',
    });
    if (!parsed.success) {
      return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
    }

    const staff = await exigirStaff();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('products')
      .insert({
        restaurant_id: staff.restaurantId,
        category_id: parsed.data.categoriaId,
        name: parsed.data.nome,
        price_cents: parsed.data.preco,
        is_available: false,
      })
      .select('id')
      .single();

    if (error) return { ok: false, erro: error.message };

    revalidatePath('/app/cardapio');
    return { ok: true, id: data.id as string };
  } catch (err) {
    return falha(err);
  }
}

/** Liga e desliga o item — o "acabou" da cozinha e do garçom. */
export async function alternarDisponibilidade(
  id: string,
  disponivel: boolean,
): Promise<ResultadoDaEdicao> {
  try {
    await exigirEditor();

    const supabase = await createClient();
    const { error } = await supabase
      .from('products')
      .update({ is_available: disponivel })
      .eq('id', z.uuid().parse(id));

    if (error) return { ok: false, erro: error.message };

    revalidatePath('/app/cardapio');
    return { ok: true };
  } catch (err) {
    return falha(err);
  }
}

/** Arquiva ou desarquiva. Produto não se apaga — `order_items` aponta para ele. */
export async function arquivarProduto(
  id: string,
  arquivar: boolean,
): Promise<ResultadoDaEdicao> {
  try {
    await exigirEditor();

    const supabase = await createClient();
    const { error } = await supabase.rpc('archive_product', {
      p_product_id: z.uuid().parse(id),
      p_arquivar: arquivar,
    });

    if (error) return { ok: false, erro: error.message };

    revalidatePath('/app/cardapio');
    revalidatePath(`/app/cardapio/${id}`);
    return { ok: true };
  } catch (err) {
    return falha(err);
  }
}

// ---------------------------------------------------------------------------
// FOTO (spec §13.2)
// ---------------------------------------------------------------------------

/**
 * Registra no produto a foto que o navegador acabou de subir.
 *
 * A conversão para WebP e o corte para ≤50 KB acontecem NO NAVEGADOR, antes do
 * upload (`comprimir-foto.ts`). O arquivo original nunca sai do aparelho de
 * quem escolheu — que é a forma mais direta de cumprir "nunca sirva o upload
 * original" da §13.2: ele não chega nem a existir no servidor.
 *
 * O que segura o resto é o bucket, não esta função: `product-photos` aceita só
 * webp/avif/jpeg/png e tem teto de tamanho, e a policy de escrita exige
 * `menu.content` e a pasta do próprio restaurante.
 *
 * LIMITE CONHECIDO: não há reprocessamento no servidor. Um funcionário
 * autenticado com `menu.content` pode subir um arquivo que passe pelo
 * `content-type` e não seja a imagem que diz ser. O que reduz o alcance disso é
 * o `next/image`, que reencoda ao servir — mas quem pedir a URL pública do
 * Storage direto recebe o arquivo como veio.
 */
const foto = z.object({
  id: z.uuid(),
  caminho: z
    .string()
    .trim()
    .min(1)
    // Só o caminho relativo dentro do bucket. Aceitar URL completa deixaria a
    // tela apontar a foto do produto para qualquer domínio — que é conteúdo
    // de terceiro servido como se fosse da casa.
    .regex(/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/, 'Caminho de foto inválido'),
});

export async function registrarFoto(formData: FormData): Promise<ResultadoDaEdicao> {
  try {
    const staff = await exigirEditor();

    const parsed = foto.safeParse({
      id: formData.get('id'),
      caminho: formData.get('caminho'),
    });
    if (!parsed.success) {
      return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Foto inválida' };
    }

    // A pasta é o restaurante de quem está logado. Vem do servidor, nunca do
    // formulário: aceitar a pasta do cliente deixaria alguém gravar a foto de
    // outro restaurante no próprio produto.
    const [pasta] = parsed.data.caminho.split('/');
    if (pasta !== staff.restaurantId) {
      return { ok: false, erro: 'Foto de outro restaurante' };
    }

    // Grava o CAMINHO, nunca a URL montada: é a convenção da migration 0015,
    // e gravar a URL absoluta amarraria a foto ao domínio de hoje.
    const supabase = await createClient();
    const { error } = await supabase
      .from('products')
      .update({ image_url: parsed.data.caminho })
      .eq('id', parsed.data.id);

    if (error) return { ok: false, erro: error.message };

    revalidatePath('/app/cardapio');
    revalidatePath(`/app/cardapio/${parsed.data.id}`);
    return { ok: true };
  } catch (err) {
    return falha(err);
  }
}

export async function removerFoto(id: string): Promise<ResultadoDaEdicao> {
  try {
    await exigirEditor();

    const supabase = await createClient();
    const { error } = await supabase
      .from('products')
      .update({ image_url: null })
      .eq('id', z.uuid().parse(id));

    if (error) return { ok: false, erro: error.message };

    revalidatePath('/app/cardapio');
    revalidatePath(`/app/cardapio/${id}`);
    return { ok: true };
  } catch (err) {
    return falha(err);
  }
}

// ---------------------------------------------------------------------------
// CATEGORIA
// ---------------------------------------------------------------------------

const categoria = z.object({
  id: z.uuid().nullable(),
  nome: z.string().trim().min(1, 'O nome não pode ficar vazio').max(80),
  ordem: z.coerce.number().int().min(0).max(999),
  estacao: z.enum(['cozinha', 'bar']),
  // Janela de serviço: as duas pontas ou nenhuma. Meia janela é um estado que
  // o CHECK da tabela recusa, e é melhor dizer isso aqui do que devolver erro
  // de constraint.
  de: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  ate: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
});

export async function salvarCategoria(formData: FormData): Promise<ResultadoDaEdicao> {
  try {
    const staff = await exigirEditor();

    const parsed = categoria.safeParse({
      id: formData.get('id') || null,
      nome: formData.get('nome'),
      ordem: formData.get('ordem') || 0,
      estacao: formData.get('estacao') || 'cozinha',
      de: formData.get('de') || null,
      ate: formData.get('ate') || null,
    });
    if (!parsed.success) {
      return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
    }

    const { id, nome, ordem, estacao, de, ate } = parsed.data;
    if ((de === null) !== (ate === null)) {
      return { ok: false, erro: 'Informe as duas pontas do horário, ou nenhuma' };
    }

    const supabase = await createClient();
    const campos = {
      name: nome,
      sort_order: ordem,
      station: estacao,
      available_from: de,
      available_to: ate,
    };

    const { error } = id
      ? await supabase.from('categories').update(campos).eq('id', id)
      : await supabase
          .from('categories')
          .insert({ ...campos, restaurant_id: staff.restaurantId });

    if (error) return { ok: false, erro: error.message };

    revalidatePath('/app/cardapio');
    return { ok: true };
  } catch (err) {
    return falha(err);
  }
}
