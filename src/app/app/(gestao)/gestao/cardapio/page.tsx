import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';
import { CameraOffIcon } from 'lucide-react';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Cartao, Celula, Linha, Numero, Tabela, Vazio } from '@/components/gestao/painel';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarCardapio, carregarProdutos } from '@/lib/gestao/queries';
import { normalizarPeriodo } from '@/lib/gestao/periodo';
import { formatCents } from '@/lib/money';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Cardápio · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Cardápio visto pelo lado do dinheiro (spec §8).
 *
 * Só LEITURA. Editar preço, foto e estrutura é a Etapa 9, e a separação não é
 * cronograma: alterar preço é o vetor de fraude mais comum da §12.9, e o
 * caminho de escrita tem exigências próprias — trilha em audit_log, permissão
 * delegável, confirmação. Um campo editável enfiado num relatório não tem nada
 * disso.
 *
 * O que esta tela responde: o que ninguém pede, o que está fora do ar, o que
 * não tem foto. Item sem foto vende menos e some do cardápio na prática.
 */
export default async function Cardapio({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const staff = await exigirStaff();
  if (!can(staff, 'dashboard.view')) forbidden();

  const periodo = normalizarPeriodo((await searchParams).periodo);
  const [cardapio, vendidos] = await Promise.all([
    carregarCardapio(),
    carregarProdutos(periodo),
  ]);

  const vendaPorProduto = new Map(vendidos.map((v) => [v.produtoId, v]));
  const ativos = cardapio.filter((p) => !p.arquivado);

  const semFoto = ativos.filter((p) => !p.temFoto);
  const foraDoAr = ativos.filter((p) => !p.disponivel);
  const parados = ativos.filter((p) => p.disponivel && !vendaPorProduto.has(p.id));

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Cardápio"
        descricao={`${ativos.length} itens ativos · desempenho dos últimos ${periodo} dias`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Numero
          rotulo="Sem venda no período"
          valor={String(parados.length)}
          detalhe="estão no ar e ninguém pediu"
          tom={parados.length > 0 ? 'alerta' : 'bom'}
        />
        <Numero
          rotulo="Fora do ar"
          valor={String(foraDoAr.length)}
          detalhe="marcados como indisponíveis"
          tom={foraDoAr.length > 0 ? 'alerta' : 'neutro'}
        />
        <Numero
          rotulo="Sem foto"
          valor={String(semFoto.length)}
          detalhe="item sem foto some do cardápio na prática"
          tom={semFoto.length > 0 ? 'alerta' : 'bom'}
        />
      </div>

      <Cartao titulo="Todos os itens">
        {ativos.length === 0 ? (
          <Vazio>Nenhum item no cardápio.</Vazio>
        ) : (
          <Tabela
            colunas={[
              'Item',
              'Categoria',
              { rotulo: 'Preço', alinhar: 'direita' },
              { rotulo: 'Preparo', alinhar: 'direita' },
              { rotulo: 'Vendas', alinhar: 'direita' },
              { rotulo: 'Receita', alinhar: 'direita' },
              'Estado',
            ]}
          >
            {ativos.map((p) => {
              const v = vendaPorProduto.get(p.id);
              return (
                <Linha key={p.id}>
                  <Celula className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {p.nome}
                      {!p.temFoto && (
                        <CameraOffIcon
                          className="size-3.5 text-alert-warning"
                          aria-label="sem foto"
                        />
                      )}
                    </span>
                  </Celula>
                  <Celula fraca>{p.categoria}</Celula>
                  <Celula direita>{formatCents(p.precoCents)}</Celula>
                  <Celula direita fraca>
                    {p.prepMinutos ? `${p.prepMinutos} min` : '—'}
                  </Celula>
                  <Celula direita fraca={!v}>{v ? v.quantidade : '—'}</Celula>
                  <Celula direita fraca={!v}>{v ? formatCents(v.receitaCents) : '—'}</Celula>
                  <Celula>
                    {!p.disponivel ? (
                      <span className="rounded bg-alert-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-alert-warning">
                        fora do ar
                      </span>
                    ) : !v ? (
                      <span className="text-[11px] text-muted-foreground">sem venda</span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">no ar</span>
                    )}
                  </Celula>
                </Linha>
              );
            })}
          </Tabela>
        )}
      </Cartao>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Para alterar preço, foto ou estrutura, use o editor de cardápio.
      </p>
    </div>
  );
}
