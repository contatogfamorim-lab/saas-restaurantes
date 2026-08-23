'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Contador subindo, com cor mudando por faixa.
 *
 * O tempo de espera é a informação mais acionável da fila do garçom: um pedido
 * parado há 3 minutos é um cliente olhando para o celular sem entender por quê.
 *
 * `segundosIniciais` vem do SERVIDOR, calculado em SQL, e não de um
 * `Date.now()` no cliente — relógio de celular erra, e o de tablet de
 * restaurante erra mais. O componente só continua contando a partir dali.
 */
interface Props {
  segundosIniciais: number;
  /** Acima disso fica âmbar; ao dobro, vermelho. */
  alertaSegundos?: number;
  className?: string;
}

export function Elapsed({ segundosIniciais, alertaSegundos = 60, className }: Props) {
  const [decorrido, setDecorrido] = useState(0);
  const [base, setBase] = useState(segundosIniciais);

  // Padrão oficial do React para ajustar estado quando a prop muda: setState
  // DURANTE o render, não num efeito. Cada recarga da tela traz um valor novo
  // do servidor, e a contagem local recomeça a partir dele — sem somar duas
  // vezes o tempo que já passou.
  if (base !== segundosIniciais) {
    setBase(segundosIniciais);
    setDecorrido(0);
  }

  useEffect(() => {
    const id = setInterval(() => setDecorrido((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const segundos = base + decorrido;
  const critico = segundos >= alertaSegundos * 2;
  const atencao = !critico && segundos >= alertaSegundos;

  return (
    <span
      className={cn(
        'tabular text-[13px] font-bold',
        critico && 'text-alert-critical',
        atencao && 'text-alert-warning',
        !critico && !atencao && 'text-muted-foreground',
        className,
      )}
    >
      {formatar(segundos)}
    </span>
  );
}

export function formatar(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}
