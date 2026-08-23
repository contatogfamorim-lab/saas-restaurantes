import { NextResponse } from 'next/server';
import { z } from 'zod';

import { mapOrderError } from '@/lib/orders/errors';
import { readTableSession } from '@/lib/session/cookie';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/pedidos — envia uma rodada.
 *
 * REGRA DE OURO (spec §10.1): o cliente manda apenas o que escolheu, nunca
 * quanto custa. O schema abaixo é a fronteira que garante isso — se um campo
 * monetário aparecesse aqui, o desenho estaria errado.
 *
 * `session_id` NÃO está no schema de propósito. Ele vem do cookie assinado e
 * de lugar nenhum mais (spec §10.4): aceitá-lo do corpo seria entregar a
 * comanda da mesa ao lado a quem trocasse um uuid.
 */

const item = z.object({
  productId: z.uuid(),
  qty: z.int().min(1).max(20),
  modifierOptionIds: z.array(z.uuid()).max(20).default([]),
  notes: z.string().trim().max(280).optional(),
  /** Quem vai comer. Ausente = quem está pedindo. */
  guestId: z.uuid().optional(),
});

const corpo = z.object({
  // Gerada no cliente (spec §13.7). Reenviar o mesmo comando devolve o mesmo
  // pedido em vez de duplicar — o que importa quando o wi-fi do salão oscila.
  idempotencyKey: z.string().min(8).max(64),
  items: z.array(item).min(1).max(40),
});

export async function POST(request: Request) {
  const sessao = await readTableSession();
  if (!sessao) {
    return NextResponse.json(
      { code: 'sem_sessao', message: 'Precisamos do seu nome antes de enviar' },
      { status: 401 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'corpo_invalido', message: 'Requisição inválida' },
      { status: 400 },
    );
  }

  const parsed = corpo.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 'dados_invalidos',
        message: parsed.error.issues[0]?.message ?? 'Pedido inválido',
      },
      { status: 422 },
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('create_guest_order', {
    p_session_id: sessao.sessionId,
    p_guest_id: sessao.guestId,
    p_idempotency_key: parsed.data.idempotencyKey,
    // Só estes quatro campos atravessam. Preço, promoção, estação e curso são
    // decididos dentro do banco.
    p_items: parsed.data.items.map((i) => ({
      product_id: i.productId,
      qty: i.qty,
      modifier_option_ids: i.modifierOptionIds,
      notes: i.notes ?? null,
      guest_id: i.guestId ?? null,
    })),
  });

  if (error) {
    const mapped = mapOrderError(error);
    if (mapped.status === 500) console.error('[pedidos]', error);
    return NextResponse.json(
      { code: mapped.code, message: mapped.message },
      { status: mapped.status },
    );
  }

  return NextResponse.json({ orderId: data as string }, { status: 201 });
}
