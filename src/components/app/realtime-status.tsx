'use client';

import { WifiOffIcon } from 'lucide-react';

import { useRealtime, type EstadoConexao } from '@/lib/realtime/use-realtime';

/**
 * Liga o Realtime e mostra quando a conexão cai (spec §9).
 *
 * "Restaurante tem wi-fi ruim; a tela precisa avisar que está desatualizada em
 * vez de mentir em silêncio."
 *
 * Conectado NÃO mostra nada. Selo verde permanente vira paisagem em duas horas
 * de serviço, e aí o dia em que ficar vermelho ninguém repara. A ausência é o
 * estado normal; a presença é o alarme.
 */
export function RealtimeStatus({
  restaurantId,
  tabelas,
}: {
  restaurantId: string;
  tabelas: readonly string[];
}) {
  const estado = useRealtime({ restaurantId, tabelas });

  if (estado === 'conectado') return null;

  return <Faixa estado={estado} />;
}

function Faixa({ estado }: { estado: EstadoConexao }) {
  if (estado === 'conectando') {
    return (
      <div
        role="status"
        className="bg-muted px-3 py-1 text-center text-[12px] text-muted-foreground"
      >
        conectando…
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 bg-alert-critical px-3 py-2 text-[14px] font-bold text-background"
    >
      <WifiOffIcon className="size-4" />
      Sem conexão — esta tela pode estar desatualizada
    </div>
  );
}
