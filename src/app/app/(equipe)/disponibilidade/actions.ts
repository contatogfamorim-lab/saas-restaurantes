'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';
import { canMarkOutOfStock } from '@/lib/permissions';

/**
 * "Acabou" — ligar e desligar item.
 *
 * Mora AQUI, e não junto das ações do editor, porque a guarda é outra:
 * `menu.availability`, que a cozinha e o garçom têm. Enquanto esta função vivia
 * no editor ela herdava `canOpenMenuEditor`, e no instante em que o editor
 * passou a exigir permissão de EDIÇÃO a cozinha parou de conseguir marcar
 * esgotado — o botão aparecia, o clique não fazia nada, e nada quebrava.
 *
 * Foi encontrado clicando: o item continuou "no ar" no banco depois do toque.
 * É o tipo de regressão que teste de permissão pega e teste de rota não.
 *
 * O editor importa desta mesma função. Uma implementação, duas telas.
 */

export interface ResultadoDaEdicao {
  ok: boolean;
  erro?: string;
}

export async function alternarDisponibilidade(
  id: string,
  disponivel: boolean,
): Promise<ResultadoDaEdicao> {
  try {
    const staff = await exigirStaff();

    // Server Action é endpoint HTTP público: esconder o botão não protege
    // nada (spec §10.3). E o banco confere de novo, no
    // `products_column_guard`.
    if (!canMarkOutOfStock(staff)) {
      return { ok: false, erro: 'Sem permissão para marcar itens como esgotados' };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('products')
      .update({ is_available: disponivel })
      .eq('id', z.uuid().parse(id));

    if (error) return { ok: false, erro: error.message };

    revalidatePath('/app/disponibilidade');
    revalidatePath('/app/cardapio');
    revalidatePath(`/app/cardapio/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : String(err) };
  }
}
