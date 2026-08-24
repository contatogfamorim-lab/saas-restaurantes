import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Cartao, Celula, Linha, Numero, Tabela, Vazio } from '@/components/gestao/painel';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarCozinha, carregarRecusas } from '@/lib/gestao/queries';
import { normalizarPeriodo } from '@/lib/gestao/periodo';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Operação · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const DESFECHO: Record<string, string> = {
  cancelled: 'recusado',
  out_of_stock: 'esgotou',
};

const MOTIVO: Record<string, string> = {
  acabou: 'acabou',
  cliente_desistiu: 'cliente desistiu',
  erro_no_pedido: 'erro no pedido',
};

export default async function Operacao({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const staff = await exigirStaff();
  if (!can(staff, 'dashboard.view')) forbidden();

  const periodo = normalizarPeriodo((await searchParams).periodo);
  const [cozinha, recusas] = await Promise.all([
    carregarCozinha(periodo),
    carregarRecusas(periodo),
  ]);

  const itens = cozinha.reduce((s, c) => s + c.itens, 0);
  const atrasados = cozinha.reduce((s, c) => s + c.atrasados, 0);
  const recusados = recusas.reduce((s, r) => s + r.ocorrencias, 0);

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Operação"
        descricao={`Como a cozinha andou nos últimos ${periodo} dias`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Numero rotulo="Itens produzidos" valor={String(itens)} detalhe="do pedido à entrega" />
        <Numero
          rotulo="Preparo acima do previsto"
          valor={itens > 0 ? `${Math.round((atrasados / itens) * 100)}%` : '—'}
          detalhe={`${atrasados} itens passaram de 1,5× o tempo do produto`}
          tom={itens > 0 && atrasados / itens > 0.2 ? 'ruim' : atrasados > 0 ? 'alerta' : 'bom'}
        />
        <Numero
          rotulo="Não viraram comida"
          valor={String(recusados)}
          detalhe="recusados pelo garçom ou esgotados"
          tom={recusados > itens * 0.05 ? 'alerta' : 'neutro'}
        />
      </div>

      <Cartao titulo="Tempo por estação">
        {cozinha.length === 0 ? (
          <Vazio>Nenhum item produzido no período.</Vazio>
        ) : (
          <>
            <Tabela
              colunas={[
                'Estação',
                { rotulo: 'Itens', alinhar: 'direita' },
                { rotulo: 'Fila', alinhar: 'direita' },
                { rotulo: 'Mediana', alinhar: 'direita' },
                { rotulo: 'p90', alinhar: 'direita' },
                { rotulo: 'Acima do previsto', alinhar: 'direita' },
              ]}
            >
              {cozinha.map((c) => (
                <Linha key={c.estacao}>
                  <Celula className="font-medium capitalize">{c.estacao}</Celula>
                  <Celula direita>{c.itens}</Celula>
                  <Celula direita fraca>
                    {minutos(c.medianaFilaSeg)}
                  </Celula>
                  <Celula direita>{minutos(c.medianaSeg)}</Celula>
                  <Celula direita>{minutos(c.p90Seg)}</Celula>
                  <Celula direita fraca={c.atrasados === 0}>
                    {c.atrasados > 0
                      ? `${c.atrasados} · ${Math.round((c.atrasados / c.itens) * 100)}%`
                      : '—'}
                  </Celula>
                </Linha>
              ))}
            </Tabela>

            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Mediana, não média.</strong> Uma comanda
              esquecida por duas horas puxa a média para um número que não descreve
              nenhuma noite real. O <strong className="text-foreground">p90</strong> ao lado
              é quanto esperou quem esperou mais — é ele que corresponde à reclamação no
              salão.{' '}
              <strong className="text-foreground">Fila</strong> é o tempo entre o garçom
              aprovar e a cozinha começar; <strong className="text-foreground">mediana</strong>{' '}
              e <strong className="text-foreground">p90</strong> são o total até ficar
              pronto. Já <strong className="text-foreground">acima do previsto</strong> olha
              só o preparo — fila demorada é problema de quem não puxou o pedido, e tem
              coluna própria.
            </p>
          </>
        )}
      </Cartao>

      <Cartao titulo="O que não virou comida" className="mt-4">
        {recusas.length === 0 ? (
          <Vazio>Nenhuma recusa no período.</Vazio>
        ) : (
          <Tabela
            colunas={[
              'Produto',
              'Desfecho',
              'Motivo',
              { rotulo: 'Vezes', alinhar: 'direita' },
            ]}
          >
            {recusas.slice(0, 20).map((r, i) => (
              <Linha key={`${r.produto}-${r.desfecho}-${r.motivo}-${i}`}>
                <Celula className="font-medium">{r.produto}</Celula>
                <Celula fraca>{DESFECHO[r.desfecho] ?? r.desfecho}</Celula>
                <Celula fraca>{r.motivo ? (MOTIVO[r.motivo] ?? r.motivo) : '—'}</Celula>
                <Celula direita>{r.ocorrencias}</Celula>
              </Linha>
            ))}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}

/** Segundos → "12 min" ou "1h 04". Ninguém lê 4380 segundos. */
function minutos(seg: number): string {
  if (!seg) return '—';
  const m = Math.round(seg / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`;
}
