'use client';

import { useState, useTransition } from 'react';

import { sairDaLista } from './actions';

/**
 * O clique que descadastra.
 *
 * Cliente e não servidor porque precisa de estado: a pessoa vê "saiu" sem
 * recarregar. E porque a ação tem que sair de um GESTO — o robô de
 * pré-visualização do WhatsApp abre a página, mas não aperta botão.
 */
export function BotaoDeSaida({ token }: { token: string }) {
  const [pendente, iniciar] = useTransition();
  const [estado, setEstado] = useState<'inicial' | 'pronto' | 'erro'>('inicial');

  if (estado === 'pronto') {
    return (
      <p
        role="status"
        className="mt-7 rounded-xl bg-secondary px-4 py-4 text-[15px] leading-relaxed"
      >
        Pronto, você saiu da lista. Não vamos mais mandar promoções.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => {
            const r = await sairDaLista(token);
            setEstado(r.ok ? 'pronto' : 'erro');
          })
        }
        className="mt-7 h-12 w-full rounded-lg bg-foreground text-[15px] font-semibold text-background disabled:opacity-50"
      >
        {pendente ? 'Um momento…' : 'Sim, quero sair da lista'}
      </button>

      {estado === 'erro' && (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          Não deu certo agora. Tente de novo, ou responda a mensagem pedindo para
          sair — a casa consegue tirar você da lista.
        </p>
      )}
    </>
  );
}
