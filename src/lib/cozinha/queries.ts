import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Fila da cozinha (spec §6).
 *
 * Lida com o client AUTENTICADO: a RLS já escopa por restaurante, então um
 * tablet ligado na casa errada não mostra prato nenhum em vez de mostrar o
 * prato de outra pessoa.
 */

export type Estacao = 'cozinha' | 'bar';

export interface ItemNaProducao {
  id: string;
  produto: string;
  qty: number;
  mesa: string;
  cliente: string | null;
  notes: string | null;
  course: number;
  status: 'queued' | 'preparing' | 'ready';
  prepMinutes: number;
  /** Do servidor, não do relógio do tablet. */
  naFilaSegundos: number;
  emPreparoSegundos: number | null;
  modificadores: string[];
}

export interface FilaDaCozinha {
  naFila: ItemNaProducao[];
  emPreparo: ItemNaProducao[];
  prontos: ItemNaProducao[];
  /** Serve para o aviso sonoro saber que chegou coisa nova (spec §6). */
  assinatura: string;
}

export async function carregarFila(estacao: Estacao): Promise<FilaDaCozinha> {
  const supabase = await createClient();

  const { data: itens } = await supabase
    .from('kitchen_queue')
    .select('*')
    .eq('station', estacao)
    // Mais antigo no topo, SEMPRE (spec §6). É a única ordenação que impede um
    // prato de envelhecer esquecido no fim da lista.
    .order('queued_at', { ascending: true });

  const lista = itens ?? [];

  // Modificadores numa consulta só. Um SELECT por card faria a tela que mais
  // recarrega no sistema abrir N+1 conexões a cada ciclo.
  const ids = lista.map((i) => i.item_id as string);
  const { data: mods } = ids.length
    ? await supabase
        .from('order_item_modifiers')
        .select('order_item_id, option_name')
        .in('order_item_id', ids)
    : { data: [] };

  const porItem = new Map<string, string[]>();
  for (const m of mods ?? []) {
    const atual = porItem.get(m.order_item_id) ?? [];
    atual.push(m.option_name);
    porItem.set(m.order_item_id, atual);
  }

  const mapear = (i: (typeof lista)[number]): ItemNaProducao => ({
    id: i.item_id as string,
    produto: (i.produto as string) ?? 'Item',
    qty: i.qty as number,
    mesa: (i.mesa as string) ?? '',
    cliente: (i.cliente as string | null) ?? null,
    notes: (i.notes as string | null) ?? null,
    course: (i.course as number) ?? 2,
    status: i.status as 'queued' | 'preparing' | 'ready',
    prepMinutes: (i.prep_minutes as number) ?? 15,
    naFilaSegundos: (i.na_fila_segundos as number) ?? 0,
    emPreparoSegundos: (i.em_preparo_segundos as number | null) ?? null,
    modificadores: porItem.get(i.item_id as string) ?? [],
  });

  const todos = lista.map(mapear);

  return {
    naFila: todos.filter((i) => i.status === 'queued'),
    emPreparo: todos.filter((i) => i.status === 'preparing'),
    prontos: todos.filter((i) => i.status === 'ready'),
    // Ids da fila concatenados: muda quando entra item novo, e é isso que o
    // aviso sonoro escuta. Contar itens não serviria — um entra e outro sai no
    // mesmo ciclo, o número fica igual e o som não toca.
    assinatura: todos
      .filter((i) => i.status === 'queued')
      .map((i) => i.id)
      .join(','),
  };
}
