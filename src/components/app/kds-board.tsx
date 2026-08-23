'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellIcon, BellOffIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Estacao, FilaDaCozinha } from '@/lib/cozinha/queries';

import { KdsCard } from './kds-card';

/**
 * Quadro da cozinha (spec §6): Na fila → Em preparo → Pronto.
 *
 * Três colunas fixas em tela grande; empilhadas no celular, para o caso de
 * alguém conferir a fila do bolso. A tela de verdade é o tablet na parede.
 */
interface Props {
  fila: FilaDaCozinha;
  estacao: Estacao;
  podeRemoverDoCardapio: boolean;
}

export function KdsBoard({ fila, estacao, podeRemoverDoCardapio }: Props) {
  const router = useRouter();
  const [mudo, setMudo] = useState(false);
  const assinaturaAnterior = useRef<string | null>(null);

  // Recarga periódica — PROVISÓRIA. A Etapa 7 troca por Realtime, que é o que a
  // §9 manda usar aqui: "garçom aprova → aparece na cozinha imediatamente".
  // 6s não é imediato, mas é infinitamente melhor que uma tela parada.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 6000);
    return () => clearInterval(id);
  }, [router]);

  // Aviso sonoro em pedido novo (spec §6).
  //
  // Compara a lista de IDS, não a contagem: um item entra e outro sai no mesmo
  // ciclo, o número fica igual e o som nunca tocaria.
  useEffect(() => {
    const anterior = assinaturaAnterior.current;
    assinaturaAnterior.current = fila.assinatura;

    if (anterior === null || mudo || fila.assinatura === anterior) return;

    const idsAntes = new Set(anterior.split(',').filter(Boolean));
    const chegou = fila.assinatura.split(',').filter((id) => id && !idsAntes.has(id));
    if (chegou.length > 0) tocarAviso();
  }, [fila.assinatura, mudo]);

  const colunas = [
    { titulo: 'Na fila', itens: fila.naFila, destaque: true },
    { titulo: 'Em preparo', itens: fila.emPreparo, destaque: false },
    { titulo: 'Pronto', itens: fila.prontos, destaque: false },
  ];

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex gap-1">
          {(['cozinha', 'bar'] as const).map((e) => (
            <a
              key={e}
              href={`/app/cozinha?estacao=${e}`}
              aria-current={estacao === e ? 'page' : undefined}
              className={cn(
                'rounded-md px-4 py-2 text-base font-bold capitalize',
                estacao === e
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {e}
            </a>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setMudo((m) => !m)}
          aria-pressed={mudo}
          className="flex h-11 items-center gap-2 rounded-md bg-muted px-3 text-sm font-semibold"
        >
          {mudo ? <BellOffIcon className="size-5" /> : <BellIcon className="size-5" />}
          {mudo ? 'Mudo' : 'Som'}
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {colunas.map((coluna) => (
          <section key={coluna.titulo}>
            <h2
              className={cn(
                'mb-2 rounded-md px-3 py-2 text-lg font-black uppercase tracking-wide',
                coluna.destaque && coluna.itens.length > 0
                  ? 'bg-alert-critical text-background'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {coluna.titulo} · {coluna.itens.length}
            </h2>

            <div className="space-y-2">
              {coluna.itens.map((item) => (
                <KdsCard
                  key={item.id}
                  item={item}
                  podeRemoverDoCardapio={podeRemoverDoCardapio}
                />
              ))}
              {coluna.itens.length === 0 && (
                <p className="rounded-md border-2 border-dashed py-8 text-center text-base text-muted-foreground">
                  vazio
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Dois bipes curtos, gerados na hora pela Web Audio API.
 *
 * Sem arquivo de áudio de propósito: seria um request a mais no carregamento de
 * uma tela que fica aberta a noite inteira, e um asset a mais para servir. Dois
 * osciladores custam nada e atravessam o barulho de cozinha melhor que um som
 * grave.
 */
function tocarAviso() {
  try {
    const ctx = new AudioContext();
    const agora = ctx.currentTime;

    for (const [i, inicio] of [0, 0.18].entries()) {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.connect(ganho);
      ganho.connect(ctx.destination);

      osc.frequency.value = i === 0 ? 880 : 1174;
      ganho.gain.setValueAtTime(0.0001, agora + inicio);
      ganho.gain.exponentialRampToValueAtTime(0.25, agora + inicio + 0.01);
      ganho.gain.exponentialRampToValueAtTime(0.0001, agora + inicio + 0.14);

      osc.start(agora + inicio);
      osc.stop(agora + inicio + 0.15);
    }

    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Navegador que exige gesto do usuário antes de tocar áudio. A tela
    // continua funcionando; o som volta assim que alguém tocar em qualquer
    // botão. Não vale quebrar o KDS por causa de um bipe.
  }
}
