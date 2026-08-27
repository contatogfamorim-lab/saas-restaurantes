import type { Metadata } from 'next';
import { forbidden, notFound } from 'next/navigation';

import { exigirStaff } from '@/lib/auth/staff';
import { carregarConta } from '@/lib/caixa/queries';
import { formatCents } from '@/lib/money';
import { can } from '@/lib/permissions';
import { PrintButton } from '@/components/app/print-button';

export const metadata: Metadata = {
  title: 'Conta',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Conta impressa, 80mm (spec §7).
 *
 * HTML formatado para a impressão do navegador — impressora térmica de verdade
 * (ESC/POS) fica para depois, e a §14 diz explicitamente para não construir
 * agora. O que existe aqui já sai em qualquer impressora de cupom que aceite
 * imprimir do navegador.
 *
 * Fonte monoespaçada e larguras fixas de propósito: é o que faz coluna de preço
 * alinhar em 80mm sem depender de tabela.
 */
export default async function ContaImpressa({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const staff = await exigirStaff();
  if (!can(staff, 'payment.record')) forbidden();

  const { sessionId } = await params;
  const conta = await carregarConta(sessionId);
  if (!conta) notFound();

  const { totais } = conta;
  const agora = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());

  return (
    <>
      {/* Fundo branco e texto preto FIXOS: cupom não tem modo escuro, e o tema
          do operador não pode virar retângulo preto de toner. */}
      <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        .cupom { width: 74mm; color: #000; background: #fff; }
        @media print {
          .nao-imprimir { display: none !important; }
          html, body { background: #fff !important; }
        }
      `}</style>

      <div className="mx-auto bg-white p-3 font-mono text-[11px] leading-tight text-black">
        <div className="cupom mx-auto">
          <h1 className="text-center text-[15px] font-bold uppercase">Brasa Burger</h1>
          <p className="mt-1 text-center text-[10px]">
            {conta.mesa} · {agora}
            {conta.garcom && <> · {conta.garcom}</>}
          </p>

          <Separador />

          {conta.pessoas.map((pessoa) => {
            const itens = conta.itens.filter((i) => i.guestId === pessoa.id);
            if (itens.length === 0) return null;
            return (
              <div key={pessoa.id} className="mb-1">
                <p className="font-bold uppercase">{pessoa.nome}</p>
                {itens.map((item) => (
                  <LinhaCupom
                    key={item.id}
                    esquerda={`${item.qty}x ${item.produto}`}
                    direita={formatCents(item.totalCents)}
                    detalhe={item.modificadores.join(', ')}
                  />
                ))}
                <LinhaCupom
                  esquerda="  subtotal"
                  direita={formatCents(pessoa.totalCents)}
                />
              </div>
            );
          })}

          {/* Itens sem comensal indicado — pedidos feitos pelo garçom */}
          {conta.itens.filter((i) => !i.guestId).length > 0 && (
            <div className="mb-1">
              <p className="font-bold uppercase">Mesa</p>
              {conta.itens
                .filter((i) => !i.guestId)
                .map((item) => (
                  <LinhaCupom
                    key={item.id}
                    esquerda={`${item.qty}x ${item.produto}`}
                    direita={formatCents(item.totalCents)}
                    detalhe={item.modificadores.join(', ')}
                  />
                ))}
            </div>
          )}

          <Separador />

          <LinhaCupom esquerda="Consumo" direita={formatCents(totais.subtotalCents)} />
          {!totais.taxaRemovida && (
            <LinhaCupom
              esquerda="Taxa de servico 10%"
              direita={formatCents(totais.taxaCents)}
            />
          )}
          {totais.descontoCents > 0 && (
            <LinhaCupom
              esquerda="Desconto"
              direita={`-${formatCents(totais.descontoCents)}`}
            />
          )}

          <Separador />
          <LinhaCupom
            esquerda="TOTAL"
            direita={formatCents(totais.totalCents)}
            forte
          />

          {conta.pagamentos.map((p) => (
            <LinhaCupom
              key={p.id}
              esquerda={`  ${p.metodo}`}
              direita={formatCents(p.valorCents)}
            />
          ))}

          {totais.saldoCents > 0 && (
            <LinhaCupom
              esquerda="SALDO"
              direita={formatCents(totais.saldoCents)}
              forte
            />
          )}

          <Separador />

          <p className="mt-1 text-center text-[9px]">
            {/* A taxa de serviço é opcional por lei. Dizer isso na conta é
                obrigação de quem cobra, não gentileza. */}
            A taxa de servico e opcional.
          </p>
          <p className="mt-2 text-center text-[9px]">Nao e documento fiscal.</p>
          <p className="mt-1 text-center text-[9px]">feito com Pedidos.IA</p>
        </div>

        <div className="nao-imprimir mt-6 text-center">
          <PrintButton />
        </div>
      </div>
    </>
  );
}

function Separador() {
  return <p className="my-1 overflow-hidden text-[10px]">{'-'.repeat(42)}</p>;
}

function LinhaCupom({
  esquerda,
  direita,
  detalhe,
  forte = false,
}: {
  esquerda: string;
  direita: string;
  detalhe?: string;
  forte?: boolean;
}) {
  return (
    <>
      <div className={`flex justify-between gap-2 ${forte ? 'font-bold' : ''}`}>
        <span className="min-w-0 break-words">{esquerda}</span>
        <span className="shrink-0 tabular-nums">{direita}</span>
      </div>
      {detalhe && <p className="pl-3 text-[10px]">{detalhe}</p>}
    </>
  );
}

