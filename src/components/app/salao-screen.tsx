'use client';

import { useState } from 'react';

import type { MesaNoMapa, PedidoParaAprovar } from '@/lib/salao/queries';

import { ApprovalCard } from './approval-card';
import { FloorMap } from './floor-map';
import { TableSheet } from './table-sheet';

/**
 * Tela do salão (spec §5).
 *
 * A ordem na vertical é a ordem de urgência: fila de aprovação primeiro,
 * sempre. O garçom abre esta tela de pé, com uma mão, entre duas mesas — o que
 * estiver no topo é o que ele vai fazer.
 */
interface Props {
  pedidos: PedidoParaAprovar[];
  mesas: MesaNoMapa[];
  podeMarcarEsgotado: boolean;
  podeForcarLiberacao: boolean;
}

export function SalaoScreen({
  pedidos,
  mesas,
  podeMarcarEsgotado,
  podeForcarLiberacao,
}: Props) {
  const [mesaAberta, setMesaAberta] = useState<MesaNoMapa | null>(null);

  const ocupadas = mesas.filter((m) => m.sessionId).length;

  return (
    <div className="pb-8">
      {pedidos.length > 0 ? (
        <section className="px-3 pt-2">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-alert-critical">
            {pedidos.length} {pedidos.length === 1 ? 'pedido aguardando' : 'pedidos aguardando'}
          </h2>

          <div className="mt-2 space-y-3">
            {pedidos.map((pedido) => (
              <ApprovalCard
                key={pedido.orderId}
                pedido={pedido}
                podeMarcarEsgotado={podeMarcarEsgotado}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="px-3 py-3 text-[13px] text-muted-foreground">
          Nenhum pedido na fila.
        </p>
      )}

      <section className="mt-5">
        <h2 className="px-3 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
          Salão · {ocupadas} de {mesas.length} ocupadas
        </h2>
        <div className="mt-2">
          <FloorMap mesas={mesas} onSelecionar={setMesaAberta} />
        </div>
      </section>

      <TableSheet
        sessionId={mesaAberta?.sessionId ?? null}
        tableLabel={mesaAberta?.label ?? ''}
        onFechar={() => setMesaAberta(null)}
        podeForcar={podeForcarLiberacao}
      />
    </div>
  );
}
