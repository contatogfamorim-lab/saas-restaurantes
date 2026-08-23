'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCwIcon, WifiOffIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Recarga periódica das telas da equipe.
 *
 * PROVISÓRIO: a Etapa 7 troca isto por Realtime, que é o que a spec §9 manda
 * usar nas telas da equipe — pedido novo tem que aparecer para o garçom em
 * menos de 2s, e 8s de polling não entrega isso.
 *
 * Existe agora porque uma tela de salão que só atualiza com refresh manual é
 * pior que inútil: ela mente, e o garçom confia.
 *
 * O indicador de conexão perdida (§9) já é o definitivo — "a tela precisa
 * avisar que está desatualizada em vez de mentir em silêncio".
 */
export function AutoRefresh({ segundos = 8 }: { segundos?: number }) {
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const [atualizando, setAtualizando] = useState(false);

  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      setAtualizando(true);
      router.refresh();
      // o refresh não expõe promessa; a marca visual é só um pulso curto
      setTimeout(() => setAtualizando(false), 400);
    };

    const id = setInterval(tick, segundos * 1000);
    const aoVoltar = () => !document.hidden && tick();

    const caiu = () => setOffline(true);
    const voltou = () => {
      setOffline(false);
      tick();
    };

    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('offline', caiu);
    window.addEventListener('online', voltou);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('offline', caiu);
      window.removeEventListener('online', voltou);
    };
  }, [router, segundos]);

  if (offline) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 bg-alert-critical px-3 py-1.5 text-[13px] font-semibold text-background"
      >
        <WifiOffIcon className="size-4" />
        Sem conexão — esta tela está desatualizada
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5 px-3 py-1 text-[11px] text-muted-foreground">
      <RefreshCwIcon className={cn('size-3', atualizando && 'opacity-100', !atualizando && 'opacity-40')} />
      atualiza a cada {segundos}s
    </div>
  );
}
