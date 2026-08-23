import { NextResponse } from 'next/server';

import { clearTableSession, readTableSession } from '@/lib/session/cookie';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/pedidos/status — acompanhamento do pedido, por POLLING.
 *
 * O celular do cliente NÃO abre conexão Realtime (spec §9). O plano Pro dá 500
 * conexões para a plataforma inteira; com o cliente assinando, uma casa de 20
 * mesas gastaria ~56 e caberíamos em 9 restaurantes. Com polling de 10s,
 * cabemos em ~80. Latência de 10s é irrelevante para "seu prato está pronto" —
 * é crítica só para a cozinha, e é lá que a conexão é gasta.
 *
 * Devolve APENAS os itens da própria sessão, identificada pelo cookie assinado
 * (spec §10.2). Nenhum parâmetro de entrada: não há o que adulterar.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const sessao = await readTableSession();
  if (!sessao) {
    return NextResponse.json({ code: 'sem_sessao' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: comanda } = await admin
    .from('table_sessions')
    .select('id, status')
    .eq('id', sessao.sessionId)
    .maybeSingle();

  // Mesa liberada (spec §5): o cookie tem que morrer na hora. Quem escanear a
  // etiqueta de novo abre comanda nova, e não continua na conta de quem saiu.
  if (!comanda || comanda.status !== 'open') {
    await clearTableSession();
    return NextResponse.json({ code: 'mesa_liberada', encerrada: true }, { status: 410 });
  }

  const [itensRes, convidadosRes, totaisRes] = await Promise.all([
    admin
      .from('order_items')
      .select('id, qty, status, created_at, guest_id, products(name), orders!inner(session_id, status)')
      .eq('orders.session_id', sessao.sessionId)
      .order('created_at'),
    admin
      .from('session_guests')
      .select('id, display_name')
      .eq('session_id', sessao.sessionId)
      .order('joined_at'),
    admin
      .from('session_totals')
      .select('subtotal_cents, pending_cents, service_fee_cents, total_cents')
      .eq('session_id', sessao.sessionId)
      .maybeSingle(),
  ]);

  const convidados = (convidadosRes.data ?? []).map((g) => ({
    id: g.id as string,
    nome: g.display_name as string,
    euMesmo: g.id === sessao.guestId,
  }));

  const nomePorId = new Map(convidados.map((g) => [g.id, g.nome]));

  const itens = (itensRes.data ?? []).map((i) => ({
    id: i.id as string,
    nome: (i.products as unknown as { name: string } | null)?.name ?? 'Item',
    qty: i.qty as number,
    status: i.status as string,
    // quem vai comer — é o que permite dividir a conta depois
    comensal: i.guest_id ? (nomePorId.get(i.guest_id as string) ?? null) : null,
    meu: i.guest_id === sessao.guestId,
  }));

  return NextResponse.json({
    encerrada: false,
    itens,
    convidados,
    // "Ver conta parcial" (spec §4): o consumo dele e o da mesa.
    totais: totaisRes.data ?? null,
  });
}
