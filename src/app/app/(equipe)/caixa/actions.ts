'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirPermissao, exigirStaff } from '@/lib/auth/staff';
import { carregarConta, type ContaDetalhada } from '@/lib/caixa/queries';
import type { ResultadoCaixa } from '@/lib/caixa/tipos';
import { can, canApplyDiscount } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

/**
 * Ações do caixa (spec §7).
 *
 * As três que movem dinheiro validam permissão aqui E de novo dentro da função
 * SQL. Server Action é endpoint HTTP público: esconder o botão não protege
 * nada, e aqui o que está em jogo é o caixa da casa.
 */

export async function buscarConta(sessionId: string): Promise<ContaDetalhada | null> {
  await exigirPermissao('payment.record');
  return carregarConta(sessionId);
}

// ---------------------------------------------------------------------------
const pagamento = z.object({
  sessionId: z.uuid(),
  metodo: z.enum(['pix', 'credito', 'debito', 'dinheiro', 'voucher']),
  // Em CENTAVOS, inteiro. Nunca float: 0.1 + 0.2 não pode encostar num caixa.
  valorCents: z.int().min(1).max(100_000_00),
  /** Só em dinheiro: o que o cliente entregou. O troco é a diferença. */
  entregueCents: z.int().min(1).max(100_000_00).optional(),
  idempotencyKey: z.string().min(8).max(64),
});

export async function registrarPagamento(
  entrada: z.input<typeof pagamento>,
): Promise<ResultadoCaixa> {
  await exigirPermissao('payment.record');

  const parsed = pagamento.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('register_payment', {
    p_session_id: parsed.data.sessionId,
    p_method: parsed.data.metodo,
    p_amount_cents: parsed.data.valorCents,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_tendered_cents: parsed.data.entregueCents ?? undefined,
  });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/caixa');

  const r = data as { troco_cents?: number; saldo_restante_cents?: number } | null;
  return {
    ok: true,
    trocoCents: r?.troco_cents ?? 0,
    mensagem:
      r?.saldo_restante_cents === 0
        ? 'Conta quitada'
        : `Faltam ${((r?.saldo_restante_cents ?? 0) / 100).toFixed(2)}`,
  };
}

// ---------------------------------------------------------------------------
const desconto = z
  .object({
    sessionId: z.uuid(),
    motivo: z.string().trim().min(3).max(300),
    valorCents: z.int().min(1).optional(),
    percent: z.number().min(0.1).max(100).optional(),
  })
  .refine((d) => (d.valorCents === undefined) !== (d.percent === undefined), {
    message: 'Informe valor OU percentual',
  });

export async function aplicarDesconto(
  entrada: z.input<typeof desconto>,
): Promise<ResultadoCaixa> {
  const staff = await exigirPermissao('discount.apply');

  const parsed = desconto.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  // Teto por função (spec §10.3). Checado aqui para dar mensagem boa, e de novo
  // no banco — que é onde ele realmente vale, inclusive contra desconto em
  // VALOR que ultrapasse o teto percentual sem parecer.
  if (parsed.data.percent !== undefined && !canApplyDiscount(staff, parsed.data.percent)) {
    return {
      ok: false,
      mensagem: `Desconto de ${parsed.data.percent}% passa do seu limite`,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_discount', {
    p_session_id: parsed.data.sessionId,
    p_reason: parsed.data.motivo,
    p_amount_cents: parsed.data.valorCents ?? undefined,
    p_percent: parsed.data.percent ?? undefined,
  });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/caixa');

  const r = data as { valor_cents?: number; percentual?: number } | null;
  return {
    ok: true,
    mensagem: `Desconto de ${r?.percentual ?? 0}% aplicado`,
  };
}

// ---------------------------------------------------------------------------
export async function removerTaxa(
  sessionId: string,
  motivo: string,
): Promise<ResultadoCaixa> {
  await exigirPermissao('service_fee.remove');

  if (!z.uuid().safeParse(sessionId).success) {
    return { ok: false, mensagem: 'Comanda inválida' };
  }
  if (motivo.trim().length < 3) {
    return { ok: false, mensagem: 'Informe o motivo da remoção' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('waive_service_fee', {
    p_session_id: sessionId,
    p_reason: motivo.trim(),
  });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/caixa');
  return { ok: true, mensagem: 'Taxa removida' };
}

// ---------------------------------------------------------------------------
/**
 * Liberar mesa — a MESMA função da tela do garçom (spec §5).
 *
 * Não existe uma versão "do caixa": em casa pequena é a mesma pessoa, e duas
 * implementações divergiriam. A permissão é decidida pelo SALDO, não pela tela
 * de onde veio o clique.
 */
export async function liberarMesaDoCaixa(
  sessionId: string,
  opcoes: { forcada?: boolean; motivo?: string; observacao?: string } = {},
): Promise<ResultadoCaixa> {
  const staff = await exigirStaff();

  if (!can(staff, 'table.release')) {
    return { ok: false, mensagem: 'Sem permissão para liberar mesa' };
  }
  if (opcoes.forcada && !can(staff, 'table.force_release')) {
    return { ok: false, mensagem: 'Só gerente ou administrador libera mesa com saldo' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('release_table', {
    p_session_id: sessionId,
    p_forcada: opcoes.forcada ?? false,
    p_motivo: (opcoes.motivo as never) ?? undefined,
    p_observacao: opcoes.observacao ?? undefined,
  });

  if (error) {
    // Dois casos NÃO são falha: são perguntas que o sistema faz antes de deixar
    // a pessoa seguir (spec §5).
    if (error.code === '45023') {
      return { ok: false, confirmar: 'itens_na_cozinha', mensagem: error.message };
    }
    if (error.code === '45024') {
      return { ok: false, confirmar: 'saldo_em_aberto', mensagem: error.message };
    }
    return { ok: false, mensagem: traduzir(error) };
  }

  revalidatePath('/app/caixa');
  revalidatePath('/app/salao');
  return { ok: true, mensagem: 'Mesa liberada' };
}

function traduzir(error: { code?: string; message?: string }): string {
  const conhecidos: Record<string, string> = {
    '45040': 'Esta comanda não está mais aberta',
    '45041': error.message ?? 'Pagamento excede o saldo',
    '45042': error.message ?? 'Desconto acima do seu limite',
    '45043': 'Informe o motivo',
    '45044': 'A taxa já foi removida',
    '45045': 'Sem permissão',
    '45046': error.message ?? 'Valor inválido',
    '45025': 'Liberação forçada exige motivo',
    '45026': error.message ?? 'Sem permissão',
  };

  if (error.code && conhecidos[error.code]) return conhecidos[error.code];

  // Erro não previsto: detalhe no log do servidor. Mensagem crua do Postgres
  // entregaria nome de tabela e coluna a quem estiver sondando.
  console.error('[caixa]', error);
  return 'Não foi possível concluir. Tente de novo.';
}
