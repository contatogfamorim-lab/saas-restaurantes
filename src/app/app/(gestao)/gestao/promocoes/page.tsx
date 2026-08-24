import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Cartao, Celula, Linha, Numero, Tabela, Vazio } from '@/components/gestao/painel';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarPromocoes, carregarVendas } from '@/lib/gestao/queries';
import { normalizarPeriodo } from '@/lib/gestao/periodo';
import { formatCents } from '@/lib/money';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Promoções · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TIPO: Record<string, string> = {
  fixed_price: 'preço fixo',
  percent: 'percentual',
  buy_x_pay_y: 'leve X pague Y',
  free_item: 'item grátis',
};

/**
 * Quanto cada promoção custou de verdade (spec §8).
 *
 * O desconto vem da diferença entre o preço que valeria e o que foi cobrado,
 * ambos CONGELADOS no item. Não é o que a promoção prometia na configuração —
 * é o que ela tirou do caixa.
 *
 * Sem período: promoção é uma campanha inteira, e cortá-la em 7 dias esconde
 * justamente a conta que interessa, que é o total dela.
 */
export default async function Promocoes({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const staff = await exigirStaff();
  if (!can(staff, 'dashboard.view')) forbidden();

  const periodo = normalizarPeriodo((await searchParams).periodo);
  const [promocoes, vendas] = await Promise.all([
    carregarPromocoes(),
    carregarVendas(periodo),
  ]);

  const descontoTotal = promocoes.reduce((s, p) => s + p.descontoCents, 0);
  const receitaTotal = promocoes.reduce((s, p) => s + p.receitaCents, 0);
  const rodando = promocoes.filter((p) => p.status === 'active').length;

  return (
    <div className="p-5">
      <Cabecalho titulo="Promoções" descricao="Desde sempre, campanha por campanha" />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Numero rotulo="Ativas" valor={String(rodando)} detalhe={`${promocoes.length} cadastradas`} />
        <Numero
          rotulo="Desconto concedido"
          valor={formatCents(descontoTotal)}
          detalhe="acumulado de todas as campanhas"
        />
        <Numero
          rotulo="Receita com promoção"
          valor={formatCents(receitaTotal)}
          detalhe={
            vendas.totalCents > 0
              ? `nos últimos ${periodo} dias a casa fez ${formatCents(vendas.totalCents)}`
              : 'sem venda no período'
          }
        />
      </div>

      <Cartao titulo="Campanha por campanha">
        {promocoes.length === 0 ? (
          <Vazio>Nenhuma promoção cadastrada.</Vazio>
        ) : (
          <>
            <Tabela
              colunas={[
                'Promoção',
                'Tipo',
                { rotulo: 'Unidades', alinhar: 'direita' },
                { rotulo: 'Receita', alinhar: 'direita' },
                { rotulo: 'Custo', alinhar: 'direita' },
                'Estoque',
                'Estado',
              ]}
            >
              {promocoes.map((p) => (
                <Linha key={p.promotionId}>
                  <Celula className="font-medium">{p.promocao}</Celula>
                  <Celula fraca>{TIPO[p.tipo] ?? p.tipo}</Celula>
                  <Celula direita fraca={p.unidades === 0}>
                    {p.unidades || '—'}
                  </Celula>
                  <Celula direita fraca={p.receitaCents === 0}>
                    {p.receitaCents > 0 ? formatCents(p.receitaCents) : '—'}
                  </Celula>
                  <Celula direita fraca={p.descontoCents === 0}>
                    {p.descontoCents > 0 ? `−${formatCents(p.descontoCents)}` : '—'}
                  </Celula>
                  <Celula>
                    <Estoque max={p.maxQuantity} usadas={p.usadas} />
                  </Celula>
                  <Celula>
                    <span
                      className={
                        p.status === 'active'
                          ? 'rounded bg-alert-calm/15 px-1.5 py-0.5 text-[11px] font-semibold text-alert-calm'
                          : 'text-[11px] text-muted-foreground'
                      }
                    >
                      {p.status === 'active' ? 'ativa' : p.status}
                    </span>
                  </Celula>
                </Linha>
              ))}
            </Tabela>

            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              O <strong className="text-foreground">custo</strong> é a diferença entre o
              preço que valeria e o que foi cobrado — os dois congelados no item, no momento
              do pedido. É o que a promoção tirou do caixa, não o que ela prometia na
              configuração.
            </p>
          </>
        )}
      </Cartao>
    </div>
  );
}

function Estoque({ max, usadas }: { max: number | null; usadas: number }) {
  if (max == null) {
    return <span className="text-[11px] text-muted-foreground">sem limite</span>;
  }

  const restam = Math.max(0, max - usadas);
  const acabou = restam === 0;

  return (
    <span
      className={
        acabou
          ? 'text-[11px] font-semibold text-alert-critical'
          : 'text-[11px] tabular-nums text-muted-foreground'
      }
    >
      {acabou ? 'esgotada' : `${restam} de ${max}`}
    </span>
  );
}
