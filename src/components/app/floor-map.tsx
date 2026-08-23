'use client';

import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import type { MesaNoMapa } from '@/lib/salao/queries';

/**
 * Mapa do salão (spec §5).
 *
 * O semáforo comunica o que o garçom NÃO teria como saber sozinho olhando o
 * salão: que a mesa 7 pediu há 4 minutos, que a 3 tem prato pronto esfriando na
 * passagem, que a 5 está há 8 minutos sem decidir.
 *
 * Uma mesa mostra UM alerta — o mais grave. Empilhar três selos numa célula de
 * 100px transforma informação em decoração, e a pessoa para de olhar.
 */

type Nivel = 'critico' | 'atencao' | 'leve' | 'tranquila' | 'livre';

interface Alerta {
  nivel: Nivel;
  rotulo: string;
}

export function alertaDaMesa(mesa: MesaNoMapa): Alerta {
  if (!mesa.sessionId) return { nivel: 'livre', rotulo: 'Livre' };

  if (mesa.temAprovacaoPendente) return { nivel: 'critico', rotulo: 'Pedido novo' };
  if (mesa.temChamado) return { nivel: 'critico', rotulo: 'Chamou' };
  if (mesa.temProntoEsperando) return { nivel: 'atencao', rotulo: 'Pronto na passagem' };
  if (mesa.temItemAtrasado) return { nivel: 'atencao', rotulo: 'Atrasado' };
  if (mesa.indecisa) return { nivel: 'leve', rotulo: 'Indecisa' };
  if (mesa.semBebida) return { nivel: 'leve', rotulo: 'Sem bebida' };

  return { nivel: 'tranquila', rotulo: 'Tranquila' };
}

const ESTILO: Record<Nivel, string> = {
  critico: 'border-alert-critical bg-alert-critical/15 text-alert-critical',
  atencao: 'border-alert-warning bg-alert-warning/15 text-alert-warning',
  leve: 'border-alert-soft bg-alert-soft/10 text-alert-soft',
  tranquila: 'border-alert-calm/50 bg-transparent text-muted-foreground',
  livre: 'border-border bg-transparent text-muted-foreground/60',
};

interface Props {
  mesas: MesaNoMapa[];
  onSelecionar: (mesa: MesaNoMapa) => void;
}

export function FloorMap({ mesas, onSelecionar }: Props) {
  const areas = [...new Set(mesas.map((m) => m.area))];

  return (
    <div className="space-y-4">
      {areas.map((area) => (
        <section key={area}>
          <h3 className="px-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {area}
          </h3>

          <div className="mt-1.5 grid grid-cols-3 gap-2 px-3 sm:grid-cols-4">
            {mesas
              .filter((m) => m.area === area)
              .map((mesa) => {
                const alerta = alertaDaMesa(mesa);
                return (
                  <button
                    key={mesa.tableId}
                    type="button"
                    onClick={() => onSelecionar(mesa)}
                    className={cn(
                      // 64px de alvo mínimo: mão ocupada, celular numa mão só
                      'flex min-h-[72px] flex-col items-start justify-between rounded-lg border-2 p-2 text-left',
                      ESTILO[alerta.nivel],
                    )}
                  >
                    <span className="font-display text-lg leading-none text-foreground">
                      {mesa.label.replace(/^Mesa\s*/i, '')}
                    </span>

                    <span className="mt-1 text-[11px] font-semibold leading-tight">
                      {alerta.rotulo}
                    </span>

                    {mesa.totalCents !== null && mesa.totalCents > 0 && (
                      <span className="tabular text-[11px] text-muted-foreground">
                        {formatCents(mesa.totalCents)}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
