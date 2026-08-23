import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Dados da tela do caixa (spec §7).
 *
 * Lidos com o client AUTENTICADO: a RLS escopa por restaurante sozinha, e um
 * bug de `where` nunca vira comanda de outra casa aberta na tela.
 */

export interface ComandaNaLista {
  sessionId: string;
  mesa: string;
  area: string;
  garcom: string | null;
  pessoas: number;
  abertaHaSegundos: number;
  totalCents: number;
  saldoCents: number;
  pendenteCents: number;
  pediuAConta: boolean;
  emProducao: number;
}

export interface ItemDaConta {
  id: string;
  produto: string;
  qty: number;
  totalCents: number;
  guestId: string | null;
  comensal: string | null;
  orderId: string;
  status: string;
  modificadores: string[];
}

export interface PessoaNaConta {
  id: string;
  nome: string;
  /** Só o que já é cobrável — item pendente ainda pode ser recusado. */
  totalCents: number;
}

export interface PagamentoRegistrado {
  id: string;
  metodo: string;
  valorCents: number;
  trocoCents: number;
  porQuem: string | null;
  criadoEm: string;
}

export interface AjusteRegistrado {
  tipo: 'discount' | 'service_fee_waiver';
  valorCents: number;
  percent: number | null;
  motivo: string;
  porQuem: string | null;
}

export interface ContaDetalhada {
  sessionId: string;
  mesa: string;
  garcom: string | null;
  abertaHaSegundos: number;
  emProducao: number;
  pessoas: PessoaNaConta[];
  itens: ItemDaConta[];
  /** Rodadas na ordem em que foram enviadas — é o outro agrupamento da §7. */
  rodadas: { orderId: string; numero: number; itens: ItemDaConta[] }[];
  pagamentos: PagamentoRegistrado[];
  ajustes: AjusteRegistrado[];
  totais: {
    subtotalCents: number;
    pendenteCents: number;
    taxaCents: number;
    taxaRemovida: boolean;
    descontoCents: number;
    totalCents: number;
    pagoCents: number;
    saldoCents: number;
  };
}

/** Itens que entram na conta. Pendente aparece à parte: ainda pode ser recusado. */
const COBRAVEIS = ['held', 'queued', 'preparing', 'ready', 'delivered'];

export async function listarComandas(): Promise<ComandaNaLista[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('open_bills')
    .select('*')
    // Quem pediu a conta primeiro; depois a mais antiga. É a fila real do caixa.
    .order('pediu_a_conta', { ascending: false })
    .order('opened_at', { ascending: true });

  return (data ?? []).map((c) => ({
    sessionId: c.session_id as string,
    mesa: (c.mesa as string) ?? '',
    area: (c.area as string) ?? '',
    garcom: (c.garcom as string | null) ?? null,
    pessoas: (c.pessoas as number) ?? 0,
    abertaHaSegundos: (c.aberta_ha_segundos as number) ?? 0,
    totalCents: (c.total_cents as number) ?? 0,
    saldoCents: (c.balance_cents as number) ?? 0,
    pendenteCents: (c.pending_cents as number) ?? 0,
    pediuAConta: Boolean(c.pediu_a_conta),
    emProducao: (c.em_producao as number) ?? 0,
  }));
}

export async function carregarConta(sessionId: string): Promise<ContaDetalhada | null> {
  const supabase = await createClient();

  const { data: cabecalho } = await supabase
    .from('open_bills')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (!cabecalho) return null;

  const [itensRes, convidadosRes, pagamentosRes, ajustesRes] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, qty, status, total_price_cents, guest_id, order_id, created_at, products(name), session_guests(display_name), order_item_modifiers(option_name), orders!inner(session_id, created_at)')
      .eq('orders.session_id', sessionId)
      .neq('status', 'cancelled')
      .neq('status', 'out_of_stock')
      .order('created_at'),
    supabase
      .from('session_guests')
      .select('id, display_name')
      .eq('session_id', sessionId)
      .order('joined_at'),
    supabase
      .from('payments')
      .select('id, method, amount_cents, tendered_cents, created_at, profiles(name)')
      .eq('session_id', sessionId)
      .order('created_at'),
    supabase
      .from('session_adjustments')
      .select('type, amount_cents, percent, reason, profiles(name)')
      .eq('session_id', sessionId)
      .order('created_at'),
  ]);

  const itens: ItemDaConta[] = (itensRes.data ?? []).map((i) => ({
    id: i.id,
    produto: (i.products as unknown as { name: string } | null)?.name ?? 'Item',
    qty: i.qty,
    totalCents: i.total_price_cents,
    guestId: i.guest_id,
    comensal:
      (i.session_guests as unknown as { display_name: string } | null)?.display_name ??
      null,
    orderId: i.order_id,
    status: i.status,
    modificadores: (
      (i.order_item_modifiers ?? []) as unknown as { option_name: string }[]
    ).map((m) => m.option_name),
  }));

  // --- por pessoa (spec §7): é o que `order_items.guest_id` existe para servir
  const totalPorPessoa = new Map<string, number>();
  for (const item of itens) {
    if (!item.guestId || !COBRAVEIS.includes(item.status)) continue;
    totalPorPessoa.set(
      item.guestId,
      (totalPorPessoa.get(item.guestId) ?? 0) + item.totalCents,
    );
  }

  const pessoas: PessoaNaConta[] = (convidadosRes.data ?? []).map((g) => ({
    id: g.id,
    nome: g.display_name,
    totalCents: totalPorPessoa.get(g.id) ?? 0,
  }));

  // --- por rodada: cada `order` é uma rodada, numerada na ordem de envio
  const porOrder = new Map<string, ItemDaConta[]>();
  for (const item of itens) {
    const lista = porOrder.get(item.orderId) ?? [];
    lista.push(item);
    porOrder.set(item.orderId, lista);
  }

  const rodadas = [...porOrder.entries()].map(([orderId, lista], i) => ({
    orderId,
    numero: i + 1,
    itens: lista,
  }));

  return {
    sessionId,
    mesa: (cabecalho.mesa as string) ?? '',
    garcom: (cabecalho.garcom as string | null) ?? null,
    abertaHaSegundos: (cabecalho.aberta_ha_segundos as number) ?? 0,
    emProducao: (cabecalho.em_producao as number) ?? 0,
    pessoas,
    itens,
    rodadas,
    pagamentos: (pagamentosRes.data ?? []).map((p) => ({
      id: p.id,
      metodo: p.method,
      valorCents: p.amount_cents,
      trocoCents: (p.tendered_cents ?? p.amount_cents) - p.amount_cents,
      porQuem: (p.profiles as unknown as { name: string } | null)?.name ?? null,
      criadoEm: p.created_at,
    })),
    ajustes: (ajustesRes.data ?? []).map((a) => ({
      tipo: a.type as 'discount' | 'service_fee_waiver',
      valorCents: a.amount_cents,
      percent: a.percent === null ? null : Number(a.percent),
      motivo: a.reason,
      porQuem: (a.profiles as unknown as { name: string } | null)?.name ?? null,
    })),
    totais: {
      subtotalCents: (cabecalho.subtotal_cents as number) ?? 0,
      pendenteCents: (cabecalho.pending_cents as number) ?? 0,
      taxaCents: (cabecalho.service_fee_cents as number) ?? 0,
      taxaRemovida: Boolean(cabecalho.service_fee_waived),
      descontoCents: (cabecalho.discount_cents as number) ?? 0,
      totalCents: (cabecalho.total_cents as number) ?? 0,
      pagoCents: (cabecalho.paid_cents as number) ?? 0,
      saldoCents: (cabecalho.balance_cents as number) ?? 0,
    },
  };
}
