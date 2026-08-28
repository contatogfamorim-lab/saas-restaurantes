import type { Metadata } from 'next';
import { forbidden, redirect } from 'next/navigation';

import { BarraComposicao } from '@/components/gestao/barra-composicao';
import { Cabecalho } from '@/components/gestao/cabecalho';
import { GraficoDias } from '@/components/gestao/grafico-dias';
import { Cartao, Celula, Linha, Numero, Tabela, Vazio } from '@/components/gestao/painel';
import { exigirStaff } from '@/lib/auth/staff';
import {
  carregarPagamentos,
  carregarProdutos,
  carregarVendas,
  normalizarPeriodo,
} from '@/lib/gestao/queries';
import { formatCents } from '@/lib/money';
import { can, secoesVisiveis } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Vendas · Pedidos.IA',
  robots: { index: false, follow: false },
};

/** Faturamento muda a cada comanda fechada; cache aqui seria mentira. */
export const dynamic = 'force-dynamic';

export default async function Vendas({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const staff = await exigirStaff();

  // Quem entrou no console mas NÃO abre Vendas é mandado para a primeira seção
  // que abre — não recebe 403 na cara logo depois de passar pela porta.
  //
  // O gerente é exatamente esse caso: ele entra por estoque e campanhas, e
  // Vendas continua sendo do dono. Deixar cair em `forbidden()` aqui daria a
  // ele um console que só sabe dizer não.
  if (!can(staff, 'dashboard.view')) {
    const outras = secoesVisiveis(staff).filter((h) => h !== '/app/gestao');
    if (outras.length > 0) redirect(outras[0]);
    forbidden();
  }

  const periodo = normalizarPeriodo((await searchParams).periodo);

  const [vendas, pagamentos, produtos] = await Promise.all([
    carregarVendas(periodo),
    carregarPagamentos(periodo),
    carregarProdutos(periodo),
  ]);

  const aReceber = vendas.totalCents - vendas.recebidoCents;

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Vendas"
        descricao={`Últimos ${periodo} dias · comparado com os ${periodo} anteriores`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Numero
          rotulo="Faturamento"
          valor={formatCents(vendas.totalCents)}
          variacao={vendas.variacaoPct}
          detalhe={`${vendas.comandas} comandas`}
        />
        <Numero
          rotulo="Ticket médio"
          valor={formatCents(vendas.ticketMedioCents)}
          detalhe={`por pessoa · ${vendas.pessoas} no período`}
        />
        <Numero
          rotulo="Descontos"
          valor={formatCents(vendas.descontoCents)}
          detalhe="promoções + cortesias"
          tom={
            // 8% do faturamento em desconto é onde vale olhar. Não é erro —
            // é o ponto em que parar de ser promoção e virar vazamento.
            vendas.totalCents > 0 && vendas.descontoCents / vendas.totalCents > 0.08
              ? 'alerta'
              : 'neutro'
          }
        />
        <Numero
          rotulo="A receber"
          valor={formatCents(aReceber)}
          detalhe={aReceber > 0 ? 'comandas ainda abertas' : 'tudo recebido'}
          tom={aReceber > 0 ? 'alerta' : 'bom'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Cartao titulo="Faturamento por dia" className="xl:col-span-2">
          <GraficoDias dias={vendas.dias} />
        </Cartao>

        <Cartao titulo="Como o dinheiro entrou">
          <BarraComposicao
            fatias={pagamentos.map((p) => ({
              rotulo: p.metodo,
              valorCents: p.totalCents,
              detalhe: `${p.quantidade}×`,
            }))}
          />
        </Cartao>
      </div>

      <Cartao titulo="O que mais vendeu" className="mt-4">
        {produtos.length === 0 ? (
          <Vazio>Nenhum item vendido no período.</Vazio>
        ) : (
          <Tabela
            colunas={[
              'Produto',
              'Categoria',
              { rotulo: 'Qtd', alinhar: 'direita' },
              { rotulo: 'Receita', alinhar: 'direita' },
              { rotulo: 'Desconto', alinhar: 'direita' },
            ]}
          >
            {produtos.slice(0, 15).map((p) => (
              <Linha key={p.produtoId}>
                <Celula className="font-medium">{p.produto}</Celula>
                <Celula fraca>{p.categoria}</Celula>
                <Celula direita>{p.quantidade}</Celula>
                <Celula direita>{formatCents(p.receitaCents)}</Celula>
                <Celula direita fraca={p.descontoCents === 0}>
                  {p.descontoCents > 0 ? `−${formatCents(p.descontoCents)}` : '—'}
                </Celula>
              </Linha>
            ))}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
