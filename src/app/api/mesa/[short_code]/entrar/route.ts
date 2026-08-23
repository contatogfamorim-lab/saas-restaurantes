import { NextResponse } from 'next/server';
import { z } from 'zod';

import { mapOrderError } from '@/lib/orders/errors';
import { issueTableSession, readOrCreateDeviceHash } from '@/lib/session/cookie';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/mesa/[short_code]/entrar
 *
 * Identifica o cliente e abre (ou reaproveita) a comanda da mesa.
 * Só é chamado no PRIMEIRO envio de pedido — o cardápio abre sem nada disso.
 *
 * O `short_code` vem da URL, não do corpo: é o que o cliente encostou o celular
 * para ler. Toda a resolução mesa → restaurante acontece no servidor, e o
 * cliente recebe de volta apenas um cookie assinado (spec §10.4).
 */

const corpo = z.object({
  nome: z.string().trim().min(1, 'Informe seu nome').max(60),
  // Opcional por padrão; vira obrigatório quando require_phone está ligado —
  // e quem decide isso é o banco, não este schema.
  telefone: z.string().trim().max(24).optional(),
  consentimentoLgpd: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ short_code: string }> },
) {
  const { short_code } = await params;

  if (!/^[A-Za-z0-9_-]{10,32}$/.test(short_code)) {
    return NextResponse.json(
      { code: 'mesa_nao_encontrada', message: 'Mesa não encontrada' },
      { status: 404 },
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
        message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
      },
      { status: 422 },
    );
  }

  const { nome, telefone, consentimentoLgpd } = parsed.data;
  const deviceHash = await readOrCreateDeviceHash();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('open_guest_session', {
    p_short_code: short_code,
    p_display_name: nome,
    // string vazia em vez de null: a função SQL já faz `nullif(...)` depois de
    // limpar a máscara, e os tipos gerados não carregam nulabilidade de
    // argumento
    p_phone: telefone ?? '',
    p_device_hash: deviceHash,
    p_lgpd_consent: consentimentoLgpd ?? false,
  });

  if (error) {
    const mapped = mapOrderError(error);
    if (mapped.status === 500) console.error('[entrar]', error);
    return NextResponse.json(
      { code: mapped.code, message: mapped.message },
      { status: mapped.status },
    );
  }

  const sessao = data as {
    session_id: string;
    guest_id: string;
    restaurant_id: string;
    table_id: string;
    table_label: string;
  };

  await issueTableSession({
    sessionId: sessao.session_id,
    guestId: sessao.guest_id,
    restaurantId: sessao.restaurant_id,
    tableId: sessao.table_id,
  });

  // Devolve o MÍNIMO. session_id não sai daqui: ele vive no cookie assinado, e
  // o cliente não tem o que fazer com ele.
  return NextResponse.json({
    guestId: sessao.guest_id,
    mesa: sessao.table_label,
  });
}
