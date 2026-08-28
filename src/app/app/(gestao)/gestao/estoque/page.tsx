import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Estoque } from '@/components/gestao/estoque';
import { exigirStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Estoque · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Estoque e ficha técnica.
 *
 * A tela responde três perguntas, em ordem de urgência:
 *
 *  1. O QUE ESTÁ ACABANDO — abaixo do mínimo, ou já negativo. Negativo não é
 *     erro a esconder: é "você vendeu mais do que contou", e é o número que
 *     manda alguém ir até a câmara.
 *
 *  2. QUE PRATOS CAÍRAM POR FALTA DE INGREDIENTE — o elo com o cardápio. Sem
 *     isso, o dono vê o prato fora do ar e não sabe por quê.
 *
 *  3. QUANTO CUSTA CADA PRATO — o que a ficha técnica existe para responder.
 *     Sem custo, ficha técnica é uma lista de ingredientes; com custo, é a
 *     conta que diz se o prato dá lucro.
 */
export default async function EstoquePage() {
  const staff = await exigirStaff();

  // O layout já cobrou `dashboard.view`; esta linha repete porque layout não é
  // fronteira de rota (§10.3).
  if (!can(staff, 'dashboard.view')) forbidden();

  const supabase = await createClient();

  const [insumos, pratos, semIngrediente, movimentos] = await Promise.all([
    supabase.from('estoque_atual').select('*').order('name'),
    supabase
      .from('custo_dos_pratos')
      .select('*')
      .gt('itens_na_ficha', 0)
      .order('name'),
    supabase
      .from('products')
      .select('id, name')
      .eq('is_available', false)
      .eq('unavailable_reason', 'estoque')
      .is('archived_at', null),
    supabase
      .from('stock_movements')
      .select('id, ingredient_id, kind, delta, saldo_depois, motivo, created_at')
      .order('seq', { ascending: false })
      .limit(40),
  ]);

  // Engolir o erro mostraria "estoque vazio" para um problema de permissão, e
  // vazio é uma resposta plausível — ninguém desconfiaria.
  if (insumos.error) throw new Error(`estoque: ${insumos.error.message}`);
  if (pratos.error) throw new Error(`fichas: ${pratos.error.message}`);

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Estoque"
        descricao="O que tem na casa, quanto custa e o que cada prato consome"
      />

      <Estoque
        insumos={(insumos.data ?? []).map((i) => ({
          id: i.id as string,
          nome: i.name as string,
          unidade: i.unit as string,
          quantidade: Number(i.quantidade ?? 0),
          minimo: Number(i.minimo ?? 0),
          custoPorMilCents: Number(i.custo_por_mil_cents ?? 0),
          valorCents: Number(i.valor_cents ?? 0),
          abaixoDoMinimo: Boolean(i.abaixo_do_minimo),
          negativo: Boolean(i.negativo),
          pratosQueUsam: Number(i.pratos_que_usam ?? 0),
        }))}
        pratos={(pratos.data ?? []).map((p) => ({
          id: p.product_id as string,
          nome: p.name as string,
          precoCents: Number(p.price_cents ?? 0),
          custoCents: Number(p.custo_cents ?? 0),
          itensNaFicha: Number(p.itens_na_ficha ?? 0),
          porcoesPossiveis:
            p.porcoes_possiveis === null ? null : Number(p.porcoes_possiveis),
        }))}
        foraPorEstoque={(semIngrediente.data ?? []).map((p) => ({
          id: p.id as string,
          nome: p.name as string,
        }))}
        movimentos={(movimentos.data ?? []).map((m) => ({
          id: m.id as string,
          insumoId: m.ingredient_id as string,
          tipo: m.kind as string,
          delta: Number(m.delta ?? 0),
          saldoDepois: Number(m.saldo_depois ?? 0),
          motivo: (m.motivo as string | null) ?? null,
          quando: m.created_at as string,
        }))}
      />
    </div>
  );
}
