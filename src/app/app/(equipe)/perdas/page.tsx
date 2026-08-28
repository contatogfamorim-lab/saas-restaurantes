import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { PainelDePerdas } from '@/components/app/painel-de-perdas';
import { exigirStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Perdas · Pedidos.IA',
  robots: { index: false, follow: false },
};

/** O estoque muda no meio do serviço; cache aqui seria mentira. */
export const dynamic = 'force-dynamic';

/**
 * Perdas — a tela da cozinha.
 *
 * Existe porque a permissão existia e a porta não. `movimentar_estoque` aceita
 * a cozinha desde que foi escrita, e não havia tela nenhuma para ela: uma
 * capacidade que só o `psql` alcançava.
 *
 * FAZ UMA COISA SÓ, e é de propósito. Nem entrada, nem contagem, nem custo.
 *
 * O custo aparece na tela de estoque, que é da gestão — mandar a cozinha para
 * lá significaria mostrar a margem de cada prato a quem não precisa dela para
 * trabalhar. E entrada e contagem não são da cozinha: entrada mexe em nota
 * fiscal, e contagem é o momento em que o sistema aceita que estava errado.
 *
 * A tela é para de pé, com o celular na mão e a mão suja. Botões grandes,
 * uma decisão por vez, e nada que precise de conferência.
 */
export default async function Perdas() {
  const staff = await exigirStaff();
  if (!can(staff, 'stock.waste')) forbidden();

  const supabase = await createClient();

  const [insumos, recentes] = await Promise.all([
    supabase.from('ingredients').select('id, name, unit, quantidade').order('name'),
    supabase
      .from('stock_movements')
      .select('id, ingredient_id, delta, motivo, created_at, ingredients(name, unit)')
      .eq('kind', 'perda')
      .order('seq', { ascending: false })
      .limit(12),
  ]);

  // Engolir o erro mostraria "nenhum insumo" para um problema de permissão, e
  // vazio é uma resposta plausível.
  if (insumos.error) throw new Error(`insumos: ${insumos.error.message}`);

  return (
    <PainelDePerdas
      insumos={(insumos.data ?? []).map((i) => ({
        id: i.id as string,
        nome: i.name as string,
        unidade: i.unit as string,
        quantidade: Number(i.quantidade ?? 0),
      }))}
      recentes={(recentes.data ?? []).map((m) => {
        const i = m.ingredients as unknown as { name: string; unit: string } | null;
        return {
          id: m.id as string,
          nome: i?.name ?? 'insumo removido',
          unidade: i?.unit ?? 'g',
          delta: Number(m.delta ?? 0),
          motivo: (m.motivo as string | null) ?? null,
          quando: m.created_at as string,
        };
      })}
    />
  );
}
