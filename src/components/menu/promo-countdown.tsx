'use client';

import { useEffect, useState } from 'react';
import { ClockIcon, FlameIcon } from 'lucide-react';

/**
 * Contagem regressiva da promoção — só quando a janela é REAL (spec §4).
 *
 * "Nunca invente urgência" é regra, não estilo. Este componente não renderiza
 * nada sem `endsAt` vindo do banco, e o número de unidades restantes vem de
 * `max_quantity − used_quantity`, nunca de um contador decorativo.
 *
 * Abaixo de uma hora mostra minutos; acima, a hora em que acaba. Um relógio
 * piscando "01:59:47" numa promoção que dura o dia todo é pressão fabricada.
 */
interface Props {
  endsAt: string | null;
  remaining: number | null;
}

export function PromoCountdown({ endsAt, remaining }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    // 30s basta: ninguém decide um hambúrguer no segundo
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [endsAt]);

  const showScarcity = remaining !== null && remaining > 0 && remaining <= 10;
  const msLeft = endsAt ? new Date(endsAt).getTime() - now : null;
  const showClock = msLeft !== null && msLeft > 0;

  if (!showClock && !showScarcity) return null;

  const minutesLeft = showClock ? Math.floor(msLeft! / 60_000) : 0;
  const endsAtLabel = endsAt
    ? new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(endsAt))
    : null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {showClock && (
        <span className="flex items-center gap-1.5 text-[13px] text-primary">
          <ClockIcon className="size-3.5" />
          {minutesLeft < 60
            ? `Acaba em ${minutesLeft} min`
            : `Até as ${endsAtLabel}`}
        </span>
      )}

      {showScarcity && (
        <span className="flex items-center gap-1.5 text-[13px] text-primary">
          <FlameIcon className="size-3.5" />
          {remaining === 1 ? 'Resta 1 unidade' : `Restam ${remaining} unidades`}
        </span>
      )}
    </div>
  );
}
