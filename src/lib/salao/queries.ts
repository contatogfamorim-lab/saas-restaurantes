import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Dados da tela do salão.
 *
 * Lidos com o client AUTENTICADO do funcionário, não com service_role: assim a
 * RLS filtra por `restaurant_id` sozinha, e um bug de `where` nunca vira
 * vazamento entre restaurantes. O escopo do tenant não depende de eu lembrar
 * de filtrar.
 */

export interface ItemDoPedido {
  id: string;
  nome: string;
  qty: number;
  notes: string | null;
  course: number;
  station: string;
  precoCents: number;
  comensal: string | null;
  modificadores: string[];
}

export interface PedidoParaAprovar {
  orderId: string;
  sessionId: string;
  tableLabel: string;
  tableArea: string;
  guestName: string | null;
  source: string;
  esperandoSegundos: number;
  itens: ItemDoPedido[];
}

/** Um prato pronto esperando na passagem. */
export interface ItemNaPassagem {
  itemId: string;
  sessionId: string;
  mesa: string;
  area: string;
  produto: string;
  qty: number;
  estacao: string;
  cliente: string | null;
  tempo: number;
  esperandoSegundos: number;
  modificadores: string[];
  notes: string | null;
}

export interface MesaNoMapa {
  tableId: string;
  sessionId: string | null;
  label: string;
  area: string;
  seats: number;
  abertaDesde: string | null;
  totalCents: number | null;
  saldoCents: number | null;
  temAprovacaoPendente: boolean;
  temChamado: boolean;
  temProntoEsperando: boolean;
  temItemAtrasado: boolean;
  indecisa: boolean;
  semBebida: boolean;
}

export interface ItemNaComanda {
  id: string;
  nome: string;
  qty: number;
  status: string;
  course: number;
  station: string;
  totalCents: number;
  comensal: string | null;
  modificadores: string[];
  notes: string | null;
}

export interface DetalheDaMesa {
  sessionId: string;
  tableLabel: string;
  /**
   * Segundos de mesa aberta, calculados no SERVIDOR.
   *
   * Não mando o `opened_at` para o cliente subtrair de `Date.now()`: relógio de
   * celular erra, e o de tablet de restaurante que fica ligado meses erra mais.
   * O cliente só continua contando a partir deste número.
   */
  abertaHaSegundos: number;
  guestCount: number | null;
  convidados: { id: string; nome: string }[];
  itens: ItemNaComanda[];
  totais: {
    subtotal_cents: number;
    pending_cents: number;
    service_fee_cents: number;
    total_cents: number;
    paid_cents: number;
    balance_cents: number;
  } | null;
  chamados: { id: string; tipo: string; desdeSegundos: number }[];
  /** Cursos com itens retidos, para o botão "Liberar principais" (spec §5). */
  cursosRetidos: number[];
}

export async function carregarMesa(sessionId: string): Promise<DetalheDaMesa | null> {
  const supabase = await createClient();

  const { data: sessao } = await supabase
    .from('table_sessions')
    .select('id, opened_at, guest_count, restaurant_tables(label)')
    .eq('id', sessionId)
    .maybeSingle();

  if (!sessao) return null;

  const [itensRes, convidadosRes, totaisRes, chamadosRes] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, qty, status, course, station, total_price_cents, notes, created_at, products(name), session_guests(display_name), order_item_modifiers(option_name), orders!inner(session_id)')
      .eq('orders.session_id', sessionId)
      .neq('status', 'cancelled')
      .order('created_at'),
    supabase
      .from('session_guests')
      .select('id, display_name')
      .eq('session_id', sessionId)
      .order('joined_at'),
    supabase
      .from('session_totals')
      .select('subtotal_cents, pending_cents, service_fee_cents, total_cents, paid_cents, balance_cents')
      .eq('session_id', sessionId)
      .maybeSingle(),
    supabase
      .from('waiter_calls')
      .select('id, type, created_at')
      .eq('session_id', sessionId)
      .eq('status', 'open'),
  ]);

  const agora = Date.now();

  const itens: ItemNaComanda[] = (itensRes.data ?? []).map((i) => ({
    id: i.id,
    nome: (i.products as unknown as { name: string } | null)?.name ?? 'Item',
    qty: i.qty,
    status: i.status,
    course: i.course,
    station: i.station,
    totalCents: i.total_price_cents,
    comensal:
      (i.session_guests as unknown as { display_name: string } | null)?.display_name ??
      null,
    modificadores: (
      (i.order_item_modifiers ?? []) as unknown as { option_name: string }[]
    ).map((m) => m.option_name),
    notes: i.notes,
  }));

  return {
    sessionId,
    tableLabel:
      (sessao.restaurant_tables as unknown as { label: string } | null)?.label ?? 'Mesa',
    abertaHaSegundos: Math.max(
      0,
      Math.floor((agora - new Date(sessao.opened_at).getTime()) / 1000),
    ),
    guestCount: sessao.guest_count,
    convidados: (convidadosRes.data ?? []).map((g) => ({
      id: g.id,
      nome: g.display_name,
    })),
    itens,
    // Coluna de VIEW nasce anulável nos tipos gerados — o Postgres não sabe
    // provar que a expressão nunca dá null. Aqui ela nunca dá: os cálculos são
    // todos coalesce/greatest. O zero é só para o TypeScript ficar tranquilo.
    totais: totaisRes.data
      ? {
          subtotal_cents: totaisRes.data.subtotal_cents ?? 0,
          pending_cents: totaisRes.data.pending_cents ?? 0,
          service_fee_cents: totaisRes.data.service_fee_cents ?? 0,
          total_cents: totaisRes.data.total_cents ?? 0,
          paid_cents: totaisRes.data.paid_cents ?? 0,
          balance_cents: totaisRes.data.balance_cents ?? 0,
        }
      : null,
    chamados: (chamadosRes.data ?? []).map((c) => ({
      id: c.id,
      tipo: c.type,
      desdeSegundos: Math.floor((agora - new Date(c.created_at).getTime()) / 1000),
    })),
    cursosRetidos: [...new Set(itens.filter((i) => i.status === 'held').map((i) => i.course))].sort(),
  };
}

export async function carregarSalao() {
  const supabase = await createClient();

  const [filaRes, mapaRes, chamadosRes, passagemRes] = await Promise.all([
    supabase.from('approval_queue').select('*').order('created_at'),
    supabase.from('table_status').select('*'),
    supabase
      .from('waiter_calls')
      .select('id, session_id, table_id, type, created_at')
      .eq('status', 'open')
      .order('created_at'),
    // Ordenado pelo mais antigo: quem ficou pronto primeiro é quem está
    // esfriando há mais tempo, e é essa a fila que importa.
    supabase.from('ready_pass').select('*').order('ready_at'),
  ]);

  const fila = filaRes.data ?? [];

  // Itens de todos os pedidos da fila numa consulta só. Um SELECT por card
  // faria a tela mais usada do sistema abrir N+1 conexões a cada refresh.
  const orderIds = fila.map((f) => f.order_id as string);
  const { data: itens } = orderIds.length
    ? await supabase
        .from('order_items')
        .select('id, order_id, qty, notes, course, station, total_price_cents, products(name), session_guests(display_name), order_item_modifiers(group_name, option_name)')
        .in('order_id', orderIds)
        .eq('status', 'pending')
    : { data: [] };

  const porPedido = new Map<string, ItemDoPedido[]>();
  for (const i of itens ?? []) {
    const lista = porPedido.get(i.order_id) ?? [];
    lista.push({
      id: i.id,
      nome: (i.products as unknown as { name: string } | null)?.name ?? 'Item',
      qty: i.qty,
      notes: i.notes,
      course: i.course,
      station: i.station,
      precoCents: i.total_price_cents,
      comensal:
        (i.session_guests as unknown as { display_name: string } | null)?.display_name ??
        null,
      modificadores: (
        (i.order_item_modifiers ?? []) as unknown as {
          group_name: string;
          option_name: string;
        }[]
      ).map((m) => m.option_name),
    });
    porPedido.set(i.order_id, lista);
  }

  const pedidos: PedidoParaAprovar[] = fila
    .map((f) => ({
      orderId: f.order_id as string,
      sessionId: f.session_id as string,
      tableLabel: f.table_label as string,
      tableArea: f.table_area as string,
      guestName: f.guest_name as string | null,
      source: f.source as string,
      esperandoSegundos: f.esperando_segundos as number,
      itens: porPedido.get(f.order_id as string) ?? [],
    }))
    // pedido cujos itens todos já foram resolvidos não é fila, é ruído
    .filter((p) => p.itens.length > 0);

  const chamadosPorMesa = new Map<string, string[]>();
  for (const c of chamadosRes.data ?? []) {
    const lista = chamadosPorMesa.get(c.table_id) ?? [];
    lista.push(c.type);
    chamadosPorMesa.set(c.table_id, lista);
  }

  const mesas: MesaNoMapa[] = (mapaRes.data ?? [])
    .map((m) => ({
      tableId: m.table_id as string,
      sessionId: (m.session_id as string | null) ?? null,
      label: m.label as string,
      area: m.area as string,
      seats: m.seats as number,
      abertaDesde: (m.opened_at as string | null) ?? null,
      totalCents: (m.total_cents as number | null) ?? null,
      saldoCents: (m.balance_cents as number | null) ?? null,
      temAprovacaoPendente: Boolean(m.has_pending_approval),
      temChamado: Boolean(m.has_open_call),
      temProntoEsperando: Boolean(m.has_ready_waiting),
      temItemAtrasado: Boolean(m.has_late_item),
      indecisa: Boolean(m.is_undecided),
      semBebida: Boolean(m.has_no_drinks),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }));

  const passagem: ItemNaPassagem[] = (passagemRes.data ?? []).map((i) => ({
    itemId: i.item_id as string,
    sessionId: i.session_id as string,
    mesa: i.mesa as string,
    area: (i.area as string) ?? '',
    produto: i.produto as string,
    qty: (i.qty as number) ?? 1,
    estacao: (i.estacao as string) ?? 'cozinha',
    cliente: (i.cliente as string | null) ?? null,
    tempo: (i.tempo as number) ?? 1,
    esperandoSegundos: (i.esperando_segundos as number) ?? 0,
    modificadores: (i.modificadores as string[] | null) ?? [],
    notes: (i.notes as string | null) ?? null,
  }));

  return { pedidos, mesas, chamados: chamadosPorMesa, passagem };
}
