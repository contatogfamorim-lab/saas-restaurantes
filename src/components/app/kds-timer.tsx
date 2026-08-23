'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Cronômetro do KDS (spec §6).
 *
 * Sobe desde `queued_at` e muda de cor por faixa:
 *   verde     dentro do tempo previsto
 *   amarelo   passou de prep_minutes
 *   vermelho  passou de 1,5× — é o mesmo limiar que marca "atrasado" no mapa
 *             do salão, então cozinha e garçom veem o problema no mesmo instante
 *
 * `segundosIniciais` vem do SERVIDOR. Relógio de tablet de cozinha erra, e um
 * cronômetro adiantado faz a equipe correr atrás de atraso que não existe.
 */
interface Props {
  segundosIniciais: number;
  prepMinutes: number;
  className?: string;
}

export function KdsTimer({ segundosIniciais, prepMinutes, className }: Props) {
  const [decorrido, setDecorrido] = useState(0);
  const [base, setBase] = useState(segundosIniciais);

  // Padrão oficial do React para ajustar estado quando a prop muda: setState
  // durante o render, não num efeito. Cada recarga traz um valor novo do
  // servidor e a contagem local recomeça dali, sem somar duas vezes.
  if (base !== segundosIniciais) {
    setBase(segundosIniciais);
    setDecorrido(0);
  }

  useEffect(() => {
    const id = setInterval(() => setDecorrido((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const segundos = Math.max(0, base + decorrido);
  const previsto = prepMinutes * 60;
  const atrasado = segundos > previsto * 1.5;
  const atencao = !atrasado && segundos > previsto;

  return (
    <span
      className={cn(
        'tabular font-bold leading-none',
        atrasado && 'text-alert-critical',
        atencao && 'text-alert-warning',
        !atrasado && !atencao && 'text-alert-calm',
        className,
      )}
    >
      {formatarRelogio(segundos)}
    </span>
  );
}

/** mm:ss até uma hora; depois h:mm — prato de mais de uma hora é outro problema. */
export function formatarRelogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}
