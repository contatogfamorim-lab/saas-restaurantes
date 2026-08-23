'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirPermissao, exigirStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';
import { carregarMesa, type DetalheDaMesa } from '@/lib/salao/queries';
import { createClient } from '@/lib/supabase/server';

/**
 * Ações da tela do salão.
 *
 * "Server Actions são endpoints HTTP públicos" (spec §10.3): esconder o botão
 * não protege nada. Cada função abaixo começa validando permissão, e o banco
 * revalida de novo dentro da própria função SQL — se esta camada fosse
 * contornada, a de baixo ainda recusaria.
 */

export interface ResultadoAcao {
  ok: boolean;
  mensagem?: string;
  /** Preenchido quando a ação precisa de confirmação explícita do humano. */
  confirmar?: 'itens_na_cozinha' | 'saldo_em_aberto';
  detalhe?: string;
}

const MOTIVOS = ['acabou', 'cliente_desistiu', 'erro_no_pedido'] as const;

const aprovacao = z.object({
  orderId: z.uuid(),
  aprovados: z.array(z.uuid()),
  recusas: z
    .array(
      z.object({
        itemId: z.uuid(),
        motivo: z.enum(MOTIVOS),
        marcarEsgotado: z.boolean().default(false),
      }),
    )
    .default([]),
  reterCursos: z.array(z.int().min(1).max(3)).default([]),
});

export async function aprovarPedido(
  entrada: z.input<typeof aprovacao>,
): Promise<ResultadoAcao> {
  await exigirPermissao('order.approve');

  const parsed = aprovacao.safeParse(entrada);
  if (!parsed.success) return { ok: false, mensagem: 'Dados inválidos' };

  const { orderId, aprovados, recusas, reterCursos } = parsed.data;

  if (aprovados.length === 0 && recusas.length === 0) {
    return { ok: false, mensagem: 'Escolha o que aprovar ou recusar' };
  }

  // Marcar esgotado é outra permissão (spec §12.9): um garçom sem
  // `menu.availability` pode recusar o item, mas não sumir com ele do cardápio.
  const staff = await exigirStaff();
  const podeEsgotar = can(staff, 'menu.availability');

  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_order', {
    p_order_id: orderId,
    p_aprovados: aprovados,
    p_recusas: recusas.map((r) => ({
      item_id: r.itemId,
      reason: r.motivo,
      mark_out_of_stock: r.marcarEsgotado && podeEsgotar,
    })),
    p_reter_cursos: reterCursos,
  });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/salao');
  revalidatePath('/app/cozinha');
  return { ok: true };
}

/**
 * Detalhe da mesa, sob demanda.
 *
 * Carregado no toque e não junto com o mapa: numa casa de 20 mesas, trazer a
 * comanda inteira de todas a cada refresh multiplicaria por vinte o custo da
 * tela mais recarregada do sistema, para mostrar uma.
 */
export async function buscarMesa(sessionId: string): Promise<DetalheDaMesa | null> {
  await exigirStaff();
  return carregarMesa(sessionId);
}

export async function entregarItem(itemId: string): Promise<ResultadoAcao> {
  await exigirPermissao('order.approve');

  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_item_delivered', { p_item_id: itemId });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/salao');
  return { ok: true };
}

export async function liberarCurso(
  sessionId: string,
  curso: number,
): Promise<ResultadoAcao> {
  await exigirPermissao('order.release_course');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('release_course', {
    p_session_id: sessionId,
    p_course: curso,
  });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/salao');
  revalidatePath('/app/cozinha');
  return { ok: true, mensagem: `${data} item(ns) liberado(s) para a cozinha` };
}

export async function resolverChamado(callId: string): Promise<ResultadoAcao> {
  await exigirStaff();

  const supabase = await createClient();
  const { error } = await supabase.rpc('resolve_waiter_call', { p_call_id: callId });

  if (error) return { ok: false, mensagem: traduzir(error) };

  revalidatePath('/app/salao');
  return { ok: true };
}

/**
 * Liberar mesa — a MESMA ação da tela do caixa (spec §5).
 *
 * Não existe uma versão "do garçom" e outra "do caixa": em casa pequena é a
 * mesma pessoa, e duas implementações divergiriam. A permissão é decidida pelo
 * SALDO, não pela tela de onde veio o clique.
 */
export const MOTIVOS_LIBERACAO = [
  'cliente_foi_embora_sem_pagar',
  'mesa_aberta_por_engano',
  'cortesia_da_casa',
  'outro',
] as const;

export type MotivoLiberacao = (typeof MOTIVOS_LIBERACAO)[number];

export async function liberarMesa(
  sessionId: string,
  opcoes: { forcada?: boolean; motivo?: MotivoLiberacao; observacao?: string } = {},
): Promise<ResultadoAcao> {
  const staff = await exigirStaff();

  if (!can(staff, 'table.release')) {
    return { ok: false, mensagem: 'Sem permissão para liberar mesa' };
  }
  if (opcoes.forcada && !can(staff, 'table.force_release')) {
    return {
      ok: false,
      mensagem: 'Só gerente ou dono libera mesa com saldo em aberto',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('release_table', {
    p_session_id: sessionId,
    p_forcada: opcoes.forcada ?? false,
    p_motivo: opcoes.motivo ?? undefined,
    p_observacao: opcoes.observacao ?? undefined,
  });

  if (error) {
    // Dois casos NÃO são falha: são perguntas que o sistema precisa fazer antes
    // de deixar a pessoa seguir (spec §5).
    if (error.code === '45023') {
      return {
        ok: false,
        confirmar: 'itens_na_cozinha',
        detalhe: error.details ?? undefined,
        mensagem: error.message,
      };
    }
    if (error.code === '45024') {
      return {
        ok: false,
        confirmar: 'saldo_em_aberto',
        detalhe: error.details ?? undefined,
        mensagem: error.message,
      };
    }
    return { ok: false, mensagem: traduzir(error) };
  }

  revalidatePath('/app/salao');
  revalidatePath('/app/caixa');
  return { ok: true };
}

function traduzir(error: { code?: string; message?: string }): string {
  const conhecidos: Record<string, string> = {
    '45020': error.message ?? 'Operação não permitida neste estado',
    '45021': 'Item não pertence a este pedido',
    '45022': 'Recusa exige motivo',
    '45025': 'Liberação forçada exige motivo',
    '45026': error.message ?? 'Sem permissão',
  };

  if (error.code && conhecidos[error.code]) return conhecidos[error.code];

  // Erro não previsto: o detalhe fica no log do servidor. Devolver a mensagem
  // crua do Postgres entregaria nome de tabela e coluna a quem estiver sondando.
  console.error('[salao]', error);
  return 'Não foi possível concluir. Tente de novo.';
}
