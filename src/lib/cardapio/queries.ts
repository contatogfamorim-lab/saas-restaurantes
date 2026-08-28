import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { urlPublicaDaFoto } from '@/lib/supabase/storage';
import type { RestricaoDoCardapio, SeloDoCardapio } from '@/lib/menu/types';

/**
 * Dados do editor de cardápio (spec §12).
 *
 * TUDO aqui passa pelo client AUTENTICADO do funcionário, nunca por
 * service_role. Não é preferência: `app.products_column_guard()` desiste
 * quando `auth.uid()` é nulo, e sob service_role ele é nulo. Uma única query
 * de escrita pelo client de admin desligaria a separação entre menu.price,
 * menu.content e menu.availability sem erro nenhum aparecer.
 */

export interface CategoriaDoEditor {
  id: string;
  nome: string;
  ordem: number;
  estacao: string;
  disponivelDe: string | null;
  disponivelAte: string | null;
  diasDaSemana: number[] | null;
  arquivada: boolean;
  itens: number;
}

export interface ProdutoDoEditor {
  id: string;
  nome: string;
  descricao: string | null;
  precoCents: number;
  disponivel: boolean;
  fotoUrl: string | null;
  prepMinutos: number;
  categoriaId: string;
  categoriaNome: string;
  ordem: number;
  arquivado: boolean;
  // Campos que o CLIENTE vê. Carregados aqui para o preview do editor ser o
  // componente de verdade com os dados de verdade — um preview aproximado é
  // pior que nenhum, porque dá confiança sem dar informação.
  servePessoas: number;
  dietTags: string[];
  badges: string[];
}

export async function carregarCategorias(): Promise<CategoriaDoEditor[]> {
  const supabase = await createClient();

  const [{ data: cats }, { data: prods }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, sort_order, station, available_from, available_to, days_of_week, archived_at')
      .order('sort_order'),
    supabase.from('products').select('category_id').is('archived_at', null),
  ]);

  const contagem = new Map<string, number>();
  for (const p of prods ?? []) {
    const id = p.category_id as string;
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }

  return (cats ?? []).map((c) => ({
    id: c.id as string,
    nome: c.name as string,
    ordem: (c.sort_order as number) ?? 0,
    estacao: (c.station as string) ?? 'cozinha',
    disponivelDe: (c.available_from as string | null) ?? null,
    disponivelAte: (c.available_to as string | null) ?? null,
    diasDaSemana: (c.days_of_week as number[] | null) ?? null,
    arquivada: c.archived_at != null,
    itens: contagem.get(c.id as string) ?? 0,
  }));
}

export async function carregarProdutos(): Promise<ProdutoDoEditor[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('products')
    // Literal único, e não concatenação: o Supabase infere o tipo do retorno a
    // partir do TEXTO do select, e uma string montada em runtime devolve
    // `GenericStringError` — o typecheck cai sem dizer o motivo verdadeiro.
    .select('id, name, description, price_cents, is_available, image_url, prep_minutes, category_id, sort_order, archived_at, serves_people, diet_tags, badges, categories(name, sort_order)')
    .order('sort_order')
    .order('name');

  return (data ?? []).map((p) => {
    const cat = p.categories as unknown as { name: string } | null;
    return {
      id: p.id as string,
      nome: p.name as string,
      descricao: (p.description as string | null) ?? null,
      precoCents: (p.price_cents as number) ?? 0,
      disponivel: Boolean(p.is_available),
      fotoUrl: urlPublicaDaFoto(supabase, p.image_url as string | null),
      prepMinutos: (p.prep_minutes as number) ?? 0,
      categoriaId: p.category_id as string,
      categoriaNome: cat?.name ?? '—',
      ordem: (p.sort_order as number) ?? 0,
      arquivado: p.archived_at != null,
      servePessoas: Number(p.serves_people ?? 1),
      dietTags: (p.diet_tags as string[] | null) ?? [],
      badges: (p.badges as string[] | null) ?? [],
    };
  });
}

export async function carregarProduto(id: string): Promise<ProdutoDoEditor | null> {
  const supabase = await createClient();

  // Sem filtro por restaurante na query: a RLS de `products_staff_read` já
  // amarra em `app.current_restaurant_id()`. Repetir aqui daria a impressão de
  // que é este filtro que protege — e no dia em que alguém o removesse por
  // parecer redundante, ninguém saberia dizer se ainda estava protegido.
  const { data } = await supabase
    .from('products')
    .select('id, name, description, price_cents, is_available, image_url, prep_minutes, category_id, sort_order, archived_at, serves_people, diet_tags, badges, categories(name)')
    .eq('id', id)
    .maybeSingle();

  if (!data) return null;

  const cat = data.categories as unknown as { name: string } | null;
  return {
    id: data.id as string,
    nome: data.name as string,
    descricao: (data.description as string | null) ?? null,
    precoCents: (data.price_cents as number) ?? 0,
    disponivel: Boolean(data.is_available),
    fotoUrl: urlPublicaDaFoto(supabase, data.image_url as string | null),
    prepMinutos: (data.prep_minutes as number) ?? 0,
    categoriaId: data.category_id as string,
    categoriaNome: cat?.name ?? '—',
    ordem: (data.sort_order as number) ?? 0,
    arquivado: data.archived_at != null,
    servePessoas: Number(data.serves_people ?? 1),
    dietTags: (data.diet_tags as string[] | null) ?? [],
    badges: (data.badges as string[] | null) ?? [],
  };
}

// ---------------------------------------------------------------------------
// HISTÓRICO DE UM ITEM
// ---------------------------------------------------------------------------

export interface MudancaDoItem {
  quando: string;
  acao: string;
  quem: string;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
}

/**
 * O que já mudou neste item.
 *
 * Fica na tela de edição, e não escondido no console: quem está prestes a
 * mexer no preço é exatamente quem precisa ver que ele mudou três vezes esta
 * semana. Auditoria que só o dono olha depois do prejuízo chega tarde.
 *
 * `audit_log` só é legível por gerente e dono (policy `audit_log_read`), então
 * para os demais isto volta vazio — sem erro, porque a lista vazia é a
 * resposta certa para quem não pode ver.
 */
export async function carregarHistorico(produtoId: string): Promise<MudancaDoItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('audit_log')
    .select('created_at, action, actor_id, before, after')
    .eq('entity_id', produtoId)
    .order('created_at', { ascending: false })
    .limit(20);

  // Um erro aqui NÃO é "não pode ver": quem não pode ver recebe zero linhas
  // pela policy, sem erro. Erro é defeito, e engolir defeito foi como a
  // primeira versão desta função devolveu lista vazia com três registros no
  // banco — sem nada aparecer em lugar nenhum.
  if (error) throw new Error(`Falha ao ler o histórico do item: ${error.message}`);
  if (!data || data.length === 0) return [];

  // O nome vem numa segunda consulta porque `audit_log.actor_id` NÃO tem
  // chave estrangeira para `profiles`, e não deve ter: a trilha precisa
  // sobreviver ao desligamento de quem agiu. Sem a FK o PostgREST não embute a
  // relação, e pedir `profiles:actor_id(name)` falha.
  const ids = [...new Set(data.map((l) => l.actor_id).filter(Boolean))] as string[];

  const nomes = new Map<string, string>();
  if (ids.length > 0) {
    const { data: perfis } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', ids);

    for (const p of perfis ?? []) nomes.set(p.id as string, p.name as string);
  }

  return data.map((l) => ({
    quando: l.created_at as string,
    acao: l.action as string,
    // Perfil apagado deixa a linha da trilha intacta e sem nome — é o
    // comportamento certo, e "desligado" diz mais que um id cru.
    quem: l.actor_id ? (nomes.get(l.actor_id as string) ?? 'desligado') : 'sistema',
    antes: (l.before as Record<string, unknown> | null) ?? null,
    depois: (l.after as Record<string, unknown> | null) ?? null,
  }));
}

/**
 * Selos e restrições da casa, para o editor de item.
 *
 * Antes o editor tinha as quatro etiquetas escritas no código. Selo cadastrado
 * pela casa nunca aparecia ali — dava para criá-lo na aba "Selos" e não havia
 * como pô-lo num prato. O editor era a única tela que não sabia da 0043.
 */
export async function carregarEtiquetas(): Promise<{
  selos: SeloDoCardapio[];
  restricoes: RestricaoDoCardapio[];
}> {
  const supabase = await createClient();

  const [selosRes, restricoesRes] = await Promise.all([
    supabase
      .from('product_badges')
      .select('slug, label, color, animation')
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('diet_restrictions')
      .select('slug, label, label_long, color')
      .eq('active', true)
      .order('sort_order'),
  ]);

  return {
    selos: (selosRes.data ?? []).map((b) => ({
      slug: b.slug,
      label: b.label,
      color: b.color,
      animation: b.animation as SeloDoCardapio['animation'],
    })),
    restricoes: (restricoesRes.data ?? []).map((d) => ({
      slug: d.slug,
      label: d.label,
      labelLong: d.label_long,
      color: d.color,
    })),
  };
}

// ---------------------------------------------------------------------------
// FICHA TÉCNICA — o que o prato consome (0052)
// ---------------------------------------------------------------------------

export interface LinhaDaFicha {
  insumoId: string;
  nome: string;
  unidade: string;
  quantidade: number;
  custoPorMilCents: number;
}

export interface InsumoDisponivel {
  id: string;
  nome: string;
  unidade: string;
  custoPorMilCents: number;
  quantidade: number;
}

/**
 * A ficha de UM prato, e a lista de insumos que ainda podem entrar nela.
 *
 * As duas juntas porque o editor precisa das duas ao mesmo tempo, e duas idas
 * ao servidor para montar um bloco só é uma ida a mais em cada abertura de
 * item — que é a tela mais usada do editor.
 */
export async function carregarFicha(produtoId: string): Promise<{
  linhas: LinhaDaFicha[];
  disponiveis: InsumoDisponivel[];
}> {
  const supabase = await createClient();

  const [ficha, insumos] = await Promise.all([
    supabase
      .from('product_ingredients')
      .select('ingredient_id, quantidade, ingredients(name, unit, custo_por_mil_cents)')
      .eq('product_id', produtoId),
    supabase
      .from('ingredients')
      .select('id, name, unit, custo_por_mil_cents, quantidade')
      .order('name'),
  ]);

  // Engolir o erro aqui mostraria "este prato não desconta nada do estoque" —
  // que é uma frase plausível, e foi exatamente o que aconteceu: uma chave
  // estrangeira duplicada quebrou o join, e a tela informou com toda a calma
  // que a ficha estava vazia. Erro de consulta não pode virar dado.
  if (ficha.error) throw new Error(`ficha técnica: ${ficha.error.message}`);
  if (insumos.error) throw new Error(`insumos: ${insumos.error.message}`);

  const linhas = (ficha.data ?? []).map((f) => {
    const i = f.ingredients as unknown as {
      name: string;
      unit: string;
      custo_por_mil_cents: number;
    } | null;
    return {
      insumoId: f.ingredient_id as string,
      nome: i?.name ?? 'insumo removido',
      unidade: i?.unit ?? 'g',
      quantidade: Number(f.quantidade ?? 0),
      custoPorMilCents: Number(i?.custo_por_mil_cents ?? 0),
    };
  });

  return {
    // Ordem alfabética, porque a do banco é a de inserção — e uma ficha de dez
    // linhas que muda de ordem a cada edição é ilegível.
    linhas: linhas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    disponiveis: (insumos.data ?? []).map((i) => ({
      id: i.id as string,
      nome: i.name as string,
      unidade: i.unit as string,
      custoPorMilCents: Number(i.custo_por_mil_cents ?? 0),
      quantidade: Number(i.quantidade ?? 0),
    })),
  };
}
