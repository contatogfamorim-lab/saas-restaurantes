import 'server-only';

import { createClient } from '@/lib/supabase/server';

// Reexportado por conveniência de quem já importa daqui; a definição mora em
// `periodo.ts` para o Client Component poder usar sem tocar em `server-only`.
export { PERIODOS, normalizarPeriodo, type Periodo } from './periodo';

/**
 * Dados do console de gestão (spec §8).
 *
 * Tudo passa pelas views da migration 0029, e nenhuma delas é uma tabela crua.
 * Isso não é preferência de estilo: as views carregam o portão de papel
 * (`app.can_view_reports()`) na própria definição, então um erro aqui em cima
 * devolve zero linhas em vez de faturamento para quem não deveria ver.
 *
 * Ler `payments` direto daqui pareceria igual e não seria: `payments_staff_read`
 * libera para qualquer funcionário da casa.
 */


/**
 * Primeiro dia do período, no fuso do restaurante.
 *
 * Calculado em JS a partir de `Intl`, e não com `new Date()` cru: o servidor
 * roda em UTC, e "7 dias atrás" às 21h de Brasília seria um dia a mais.
 */
function desde(dias: number, timezone = 'America/Sao_Paulo'): string {
  const agora = new Date();
  const local = new Date(agora.toLocaleString('en-US', { timeZone: timezone }));
  local.setDate(local.getDate() - (dias - 1));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
    local.getDate(),
  ).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// VENDAS
// ---------------------------------------------------------------------------

export interface DiaDeVenda {
  dia: string;
  comandas: number;
  pessoas: number;
  brutoCents: number;
  descontoPromocaoCents: number;
  descontoManualCents: number;
  taxaServicoCents: number;
  totalCents: number;
  recebidoCents: number;
  ticketMedioCents: number;
}

export interface ResumoDeVendas {
  dias: DiaDeVenda[];
  totalCents: number;
  recebidoCents: number;
  comandas: number;
  pessoas: number;
  ticketMedioCents: number;
  descontoCents: number;
  /** Variação percentual contra o período anterior de mesmo tamanho. */
  variacaoPct: number | null;
}

export async function carregarVendas(periodo: number): Promise<ResumoDeVendas> {
  const supabase = await createClient();

  // Pede o DOBRO do período para ter com o que comparar. Um faturamento sem
  // referência não diz nada — R$ 12 mil na semana é bom ou ruim?
  const { data } = await supabase
    .from('daily_sales')
    .select('*')
    .gte('dia', desde(periodo * 2))
    .order('dia', { ascending: true });

  const linhas = (data ?? []).map(
    (d): DiaDeVenda => ({
      dia: d.dia as string,
      comandas: d.comandas ?? 0,
      pessoas: d.pessoas ?? 0,
      brutoCents: Number(d.bruto_cents ?? 0),
      descontoPromocaoCents: Number(d.desconto_promocao_cents ?? 0),
      descontoManualCents: Number(d.desconto_manual_cents ?? 0),
      taxaServicoCents: Number(d.taxa_servico_cents ?? 0),
      totalCents: Number(d.total_cents ?? 0),
      recebidoCents: Number(d.recebido_cents ?? 0),
      ticketMedioCents: d.ticket_medio_cents ?? 0,
    }),
  );

  const corte = desde(periodo);
  const atual = linhas.filter((l) => l.dia >= corte);
  const anterior = linhas.filter((l) => l.dia < corte);

  const soma = (ls: DiaDeVenda[], campo: keyof DiaDeVenda) =>
    ls.reduce((s, l) => s + (l[campo] as number), 0);

  const totalAtual = soma(atual, 'totalCents');
  const totalAnterior = soma(anterior, 'totalCents');
  const pessoas = soma(atual, 'pessoas');

  return {
    dias: atual,
    totalCents: totalAtual,
    recebidoCents: soma(atual, 'recebidoCents'),
    comandas: soma(atual, 'comandas'),
    pessoas,
    // Recalculado sobre o período inteiro, e não pela média das médias: dias
    // com uma comanda pesariam igual a um sábado cheio.
    ticketMedioCents: pessoas > 0 ? Math.round(totalAtual / pessoas) : 0,
    descontoCents: soma(atual, 'descontoManualCents') + soma(atual, 'descontoPromocaoCents'),
    // Sem período anterior não existe variação. Mostrar 0% ou 100% seria
    // inventar uma comparação que não aconteceu.
    variacaoPct:
      totalAnterior > 0
        ? Math.round(((totalAtual - totalAnterior) / totalAnterior) * 100)
        : null,
  };
}

export interface MeioDePagamento {
  metodo: string;
  quantidade: number;
  totalCents: number;
}

export async function carregarPagamentos(periodo: number): Promise<MeioDePagamento[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payment_mix')
    .select('method, quantidade, total_cents')
    .gte('dia', desde(periodo));

  // A view devolve tudo anulável — Postgres não promete `not null` através de
  // uma view, e o gerador de tipos é fiel a isso. Linha sem chave é linha que
  // não dá para agrupar; some em silêncio em vez de virar um grupo "null".
  const porMetodo = new Map<string, MeioDePagamento>();
  for (const l of data ?? []) {
    if (!l.method) continue;
    const atual = porMetodo.get(l.method) ?? {
      metodo: l.method,
      quantidade: 0,
      totalCents: 0,
    };
    atual.quantidade += l.quantidade ?? 0;
    atual.totalCents += Number(l.total_cents ?? 0);
    porMetodo.set(l.method, atual);
  }

  return [...porMetodo.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export interface ProdutoVendido {
  produtoId: string;
  produto: string;
  categoria: string;
  quantidade: number;
  receitaCents: number;
  descontoCents: number;
}

export async function carregarProdutos(periodo: number): Promise<ProdutoVendido[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('product_sales')
    .select('product_id, produto, categoria, quantidade, receita_cents, desconto_cents')
    .gte('dia', desde(periodo));

  const acc = new Map<string, ProdutoVendido>();
  for (const l of data ?? []) {
    if (!l.product_id) continue;
    const atual = acc.get(l.product_id) ?? {
      produtoId: l.product_id,
      produto: l.produto ?? '(removido)',
      categoria: l.categoria ?? '—',
      quantidade: 0,
      receitaCents: 0,
      descontoCents: 0,
    };
    atual.quantidade += l.quantidade ?? 0;
    atual.receitaCents += Number(l.receita_cents ?? 0);
    atual.descontoCents += Number(l.desconto_cents ?? 0);
    acc.set(l.product_id, atual);
  }

  return [...acc.values()].sort((a, b) => b.receitaCents - a.receitaCents);
}

// ---------------------------------------------------------------------------
// OPERAÇÃO
// ---------------------------------------------------------------------------

export interface DesempenhoDaCozinha {
  estacao: string;
  itens: number;
  atrasados: number;
  medianaSeg: number;
  p90Seg: number;
  medianaFilaSeg: number;
}

export async function carregarCozinha(periodo: number): Promise<DesempenhoDaCozinha[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('kitchen_performance')
    .select('estacao, itens, atrasados, mediana_seg, p90_seg, mediana_fila_seg')
    .gte('dia', desde(periodo));

  const acc = new Map<string, { itens: number; atrasados: number; med: number[]; p90: number[]; fila: number[] }>();
  for (const l of data ?? []) {
    if (!l.estacao) continue;
    const a = acc.get(l.estacao) ?? { itens: 0, atrasados: 0, med: [], p90: [], fila: [] };
    a.itens += l.itens ?? 0;
    a.atrasados += l.atrasados ?? 0;
    if (l.mediana_seg != null) a.med.push(l.mediana_seg);
    if (l.p90_seg != null) a.p90.push(l.p90_seg);
    if (l.mediana_fila_seg != null) a.fila.push(l.mediana_fila_seg);
    acc.set(l.estacao, a);
  }

  // Mediana das medianas diárias. NÃO é a mediana real do período — a de
  // verdade exigiria os itens crus, e trazer semanas de itens para o servidor
  // web só para calcular um percentil é o tipo de consulta que fica pesada
  // sem ninguém notar. A aproximação erra pouco e está dita aqui.
  const mediana = (ns: number[]) => {
    if (ns.length === 0) return 0;
    const ord = [...ns].sort((a, b) => a - b);
    return ord[Math.floor(ord.length / 2)];
  };

  return [...acc.entries()]
    .map(([estacao, a]) => ({
      estacao,
      itens: a.itens,
      atrasados: a.atrasados,
      medianaSeg: mediana(a.med),
      p90Seg: mediana(a.p90),
      medianaFilaSeg: mediana(a.fila),
    }))
    .sort((a, b) => b.itens - a.itens);
}

export interface Recusa {
  produto: string;
  desfecho: string;
  motivo: string | null;
  ocorrencias: number;
}

export async function carregarRecusas(periodo: number): Promise<Recusa[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('rejected_items')
    .select('produto, desfecho, motivo, ocorrencias')
    .gte('dia', desde(periodo));

  const acc = new Map<string, Recusa>();
  for (const l of data ?? []) {
    const chave = `${l.produto}|${l.desfecho}|${l.motivo ?? ''}`;
    const atual = acc.get(chave) ?? {
      produto: l.produto as string,
      desfecho: l.desfecho as string,
      motivo: (l.motivo as string | null) ?? null,
      ocorrencias: 0,
    };
    atual.ocorrencias += l.ocorrencias ?? 0;
    acc.set(chave, atual);
  }

  return [...acc.values()].sort((a, b) => b.ocorrencias - a.ocorrencias);
}

// ---------------------------------------------------------------------------
// PROMOÇÕES
// ---------------------------------------------------------------------------

export interface DesempenhoDaPromocao {
  promotionId: string;
  promocao: string;
  tipo: string;
  status: string;
  prioridade: number;
  maxQuantity: number | null;
  usadas: number;
  unidades: number;
  receitaCents: number;
  descontoCents: number;
}

export async function carregarPromocoes(): Promise<DesempenhoDaPromocao[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('promotion_performance').select('*');

  return (data ?? [])
    .map((p) => ({
      promotionId: p.promotion_id as string,
      promocao: p.promocao as string,
      tipo: p.discount_type as string,
      status: p.status as string,
      prioridade: p.priority ?? 0,
      maxQuantity: p.max_quantity as number | null,
      usadas: p.used_quantity ?? 0,
      unidades: p.unidades ?? 0,
      receitaCents: Number(p.receita_cents ?? 0),
      descontoCents: Number(p.desconto_cents ?? 0),
    }))
    .sort((a, b) => b.descontoCents - a.descontoCents);
}

// ---------------------------------------------------------------------------
// EQUIPE
// ---------------------------------------------------------------------------

export interface AcaoDeDinheiro {
  profileId: string | null;
  funcionario: string;
  acao: string;
  ocorrencias: number;
  totalCents: number;
}

export async function carregarAcoesDeDinheiro(periodo: number): Promise<AcaoDeDinheiro[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('staff_money_actions')
    .select('profile_id, funcionario, acao, ocorrencias, total_cents')
    .gte('dia', desde(periodo));

  const acc = new Map<string, AcaoDeDinheiro>();
  for (const l of data ?? []) {
    const chave = `${l.profile_id ?? 'sistema'}|${l.acao}`;
    const atual = acc.get(chave) ?? {
      profileId: (l.profile_id as string | null) ?? null,
      funcionario: (l.funcionario as string | null) ?? 'sistema',
      acao: l.acao as string,
      ocorrencias: 0,
      totalCents: 0,
    };
    atual.ocorrencias += l.ocorrencias ?? 0;
    atual.totalCents += Number(l.total_cents ?? 0);
    acc.set(chave, atual);
  }

  return [...acc.values()].sort((a, b) => b.totalCents - a.totalCents || b.ocorrencias - a.ocorrencias);
}

export interface Funcionario {
  id: string;
  nome: string;
  roles: string[];
  permissions: string[];
  operatorCode: string | null;
  ativo: boolean;
}

export async function carregarEquipe(): Promise<Funcionario[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, name, roles, permissions, operator_code, active')
    .order('name');

  return (data ?? []).map((p) => ({
    id: p.id as string,
    nome: p.name as string,
    roles: (p.roles ?? []) as string[],
    permissions: (p.permissions ?? []) as string[],
    operatorCode: (p.operator_code as string | null) ?? null,
    ativo: Boolean(p.active),
  }));
}

// ---------------------------------------------------------------------------
// CLIENTES — §10.9
// ---------------------------------------------------------------------------

export interface Cliente {
  guestId: string;
  nome: string;
  /** Já vem mascarado DO BANCO. A coluna crua está revogada. */
  telefoneMascarado: string | null;
  temTelefone: boolean;
  consentiuEm: string | null;
  visitouEm: string;
}

export async function carregarClientes(periodo: number, limite = 200): Promise<Cliente[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('customer_directory')
    .select('guest_id, nome, telefone_mascarado, tem_telefone, lgpd_consent_at, opened_at')
    .gte('opened_at', `${desde(periodo)}T00:00:00`)
    .order('opened_at', { ascending: false })
    .limit(limite);

  return (data ?? []).map((c) => ({
    guestId: c.guest_id as string,
    nome: (c.nome as string) ?? 'Convidado',
    telefoneMascarado: (c.telefone_mascarado as string | null) ?? null,
    temTelefone: Boolean(c.tem_telefone),
    consentiuEm: (c.lgpd_consent_at as string | null) ?? null,
    visitouEm: c.opened_at as string,
  }));
}

/**
 * O público de marketing — quem PODE receber mensagem.
 *
 * Deliberadamente separado de `carregarClientes`, e não uma coluna a mais lá.
 * A lista de cima é "quem passou pela casa no período"; esta é "quem autorizou
 * a gente a chamar depois", e ela não tem recorte de período: consentimento não
 * vence por a pessoa ter ficado dois meses sem vir.
 *
 * Devolve só a CONTAGEM. A tela do balcão não precisa da lista de quem
 * autorizou — precisa saber que existe e quanta gente é. Quando as campanhas
 * chegarem, quem lê nome a nome é o disparador, com `service_role`, no momento
 * de enviar.
 */
export async function contarPublicoDeMarketing(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('publico_de_marketing')
    .select('id', { count: 'exact', head: true });

  // Engolir o erro aqui mostraria "0 pessoas" para um problema de permissão — e
  // zero é uma resposta plausível, então ninguém desconfiaria. Já aconteceu uma
  // vez neste projeto, com o extrato de cashback.
  if (error) throw new Error(`público de marketing: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// AUDITORIA — §10.8
// ---------------------------------------------------------------------------

export interface RegistroDeAuditoria {
  id: string;
  quando: string;
  quem: string;
  tipoDeAtor: string;
  acao: string;
  entidade: string;
  entidadeId: string | null;
  antes: unknown;
  depois: unknown;
}

export async function carregarAuditoria(limite = 200): Promise<RegistroDeAuditoria[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('audit_log')
    .select('id, created_at, actor_type, actor_id, action, entity_type, entity_id, before, after')
    .order('created_at', { ascending: false })
    .limit(limite);

  const linhas = data ?? [];

  // Nomes num segundo passo: `audit_log` não tem FK para `profiles` de
  // propósito — o log tem que sobreviver ao funcionário ser apagado.
  const ids = [...new Set(linhas.map((l) => l.actor_id).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();

  if (ids.length > 0) {
    const { data: perfis } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', ids);
    for (const p of perfis ?? []) nomes.set(p.id as string, p.name as string);
  }

  return linhas.map((l) => ({
    id: l.id as string,
    quando: l.created_at as string,
    quem: l.actor_id ? (nomes.get(l.actor_id) ?? 'funcionário removido') : '—',
    tipoDeAtor: l.actor_type as string,
    acao: l.action as string,
    entidade: l.entity_type as string,
    entidadeId: (l.entity_id as string | null) ?? null,
    antes: l.before,
    depois: l.after,
  }));
}

// ---------------------------------------------------------------------------
// CARDÁPIO — visão de leitura. O editor é a Etapa 9.
// ---------------------------------------------------------------------------

export interface ItemDoCardapio {
  id: string;
  nome: string;
  categoria: string;
  precoCents: number;
  disponivel: boolean;
  temFoto: boolean;
  prepMinutos: number | null;
  arquivado: boolean;
}

export async function carregarCardapio(): Promise<ItemDoCardapio[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('products')
    .select('id, name, price_cents, is_available, image_url, prep_minutes, archived_at, categories(name, sort_order)')
    .order('name');

  return (data ?? []).map((p) => {
    const cat = p.categories as unknown as { name: string } | null;
    return {
      id: p.id as string,
      nome: p.name as string,
      categoria: cat?.name ?? '—',
      precoCents: p.price_cents ?? 0,
      disponivel: Boolean(p.is_available),
      temFoto: Boolean(p.image_url),
      prepMinutos: (p.prep_minutes as number | null) ?? null,
      arquivado: p.archived_at != null,
    };
  });
}
