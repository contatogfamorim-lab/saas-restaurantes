'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BellIcon, BellOffIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ItemNaPassagem } from '@/lib/salao/queries';
import { entregarItem } from '@/app/app/(equipe)/salao/actions';

import { Elapsed } from './elapsed';

/**
 * A passagem — o que a cozinha já largou e ninguém levou ainda (spec §5, §6).
 *
 * A cozinha sempre soube avisar: aperta "Pronto" no KDS, o item vira `ready` e
 * o Realtime acorda esta tela. O que faltava era o outro lado — no salão isso
 * aparecia só como uma tarja no card da mesa, ABAIXO de "Pedido novo" e
 * "Chamou", então uma mesa com pedido pendente escondia o prato pronto. E o
 * botão de entregar morava dentro da ficha da mesa: para descobrir que havia
 * comida na passagem, era preciso abrir mesa por mesa.
 *
 * Na prática, o prato esfriando embaixo da lâmpada enquanto quem devia levá-lo
 * está do outro lado do salão.
 *
 * POR QUE TEM SOM
 *
 * O garçom não fica olhando a tela — ele anda. Uma lista que só muda de cor
 * avisa quem já está olhando, que é justamente quem não precisa de aviso. O
 * KDS já bipa quando entra pedido; aqui é o mesmo problema na direção
 * contrária, e merece a mesma solução.
 */
export function Passagem({ itens }: { itens: ItemNaPassagem[] }) {
  const [mudo, setMudo] = useState(false);
  const assinaturaAnterior = useRef<string | null>(null);

  const assinatura = itens.map((i) => i.itemId).join(',');

  // Compara a lista de IDS, não a contagem: um prato sai e outro entra no mesmo
  // ciclo, o número fica igual e o som nunca tocaria.
  useEffect(() => {
    const anterior = assinaturaAnterior.current;
    assinaturaAnterior.current = assinatura;

    if (anterior === null || mudo || assinatura === anterior) return;

    const antes = new Set(anterior.split(',').filter(Boolean));
    const chegou = assinatura.split(',').filter((id) => id && !antes.has(id));
    if (chegou.length > 0) tocarAviso();
  }, [assinatura, mudo]);

  if (itens.length === 0) return null;

  return (
    <section className="px-3 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-alert-calm">
          {itens.length} na passagem
        </h2>

        <button
          type="button"
          onClick={() => setMudo((m) => !m)}
          aria-pressed={mudo}
          aria-label={mudo ? 'Ligar o aviso sonoro' : 'Desligar o aviso sonoro'}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold text-muted-foreground"
        >
          {mudo ? <BellOffIcon className="size-4" /> : <BellIcon className="size-4" />}
          {mudo ? 'Mudo' : 'Som'}
        </button>
      </div>

      <ul className="space-y-1.5">
        {itens.map((item) => (
          <ItemDaPassagem key={item.itemId} item={item} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Um prato na passagem.
 *
 * O aviso vira crítico aos 5 minutos. Não é número redondo por acaso: é mais
 * ou menos quando fritura murcha e prato quente deixa de estar quente. Antes
 * disso o alarme seria ruído; depois, é tarde.
 */
const CRITICO_SEGUNDOS = 300;

function ItemDaPassagem({ item }: { item: ItemNaPassagem }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const critico = item.esperandoSegundos >= CRITICO_SEGUNDOS;

  function entregar() {
    setErro(null);
    iniciar(async () => {
      const r = await entregarItem(item.itemId);
      if (!r.ok) setErro(r.mensagem ?? 'Não deu certo');
      else router.refresh();
    });
  }

  return (
    <li
      className={cn(
        'flex items-stretch gap-2 overflow-hidden rounded-lg border-2 bg-card',
        critico ? 'border-alert-critical' : 'border-alert-calm',
      )}
    >
      <div
        className={cn(
          'flex w-18 shrink-0 flex-col items-center justify-center px-1 py-2 text-background',
          critico ? 'bg-alert-critical' : 'bg-alert-calm',
        )}
      >
        {/* Só o número, como no mapa do salão: repetir "Mesa" em todo card
            gasta a largura que o número precisa para ser lido de longe. */}
        <span className="font-display text-3xl leading-none">
          {item.mesa.replace(/^Mesa\s*/i, '')}
        </span>
        <Elapsed
          segundosIniciais={item.esperandoSegundos}
          alertaSegundos={CRITICO_SEGUNDOS}
          className="mt-0.5 text-[12px] font-bold"
        />
      </div>

      <div className="min-w-0 flex-1 py-2">
        <p className="text-[16px] font-bold leading-tight">
          {item.qty > 1 && (
            <span className="mr-1 rounded bg-foreground px-1 text-background">
              {item.qty}×
            </span>
          )}
          {item.produto}
        </p>

        {/* A troca precisa aparecer AQUI, na entrega: dois pratos iguais na
            passagem, um sem cebola, e quem leva precisa saber qual é qual
            antes de chegar na mesa. */}
        {item.modificadores.length > 0 && (
          <p className="mt-0.5 text-[12px] font-semibold uppercase leading-tight text-alert-warning">
            {item.modificadores.join(' · ')}
          </p>
        )}

        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {item.cliente ? `${item.cliente} · ` : ''}
          {item.estacao}
          {item.area ? ` · ${item.area}` : ''}
        </p>

        {item.notes && (
          <p className="mt-0.5 text-[12px] text-alert-critical">{item.notes}</p>
        )}

        {erro && <p className="mt-0.5 text-[12px] text-alert-critical">{erro}</p>}
      </div>

      <button
        type="button"
        onClick={entregar}
        disabled={pendente}
        aria-label={`Entreguei ${item.produto} na ${item.mesa}`}
        className="w-28 shrink-0 bg-secondary text-[13px] font-bold uppercase leading-tight disabled:opacity-50"
      >
        {pendente ? '…' : 'Entreguei'}
      </button>
    </li>
  );
}

/**
 * Dois bipes curtos, gerados na hora.
 *
 * Sem arquivo de áudio, pelo mesmo motivo do KDS: seria um request a mais no
 * carregamento de uma tela que fica aberta a noite inteira. Estes são mais
 * graves que os da cozinha de propósito — quem trabalha nos dois ambientes
 * precisa distinguir "entrou pedido" de "tem prato pronto" sem olhar.
 */
function tocarAviso() {
  try {
    const ctx = new AudioContext();
    const agora = ctx.currentTime;

    for (const [i, inicio] of [0, 0.16].entries()) {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.connect(ganho);
      ganho.connect(ctx.destination);

      osc.frequency.value = i === 0 ? 523 : 698;
      ganho.gain.setValueAtTime(0.0001, agora + inicio);
      ganho.gain.exponentialRampToValueAtTime(0.22, agora + inicio + 0.01);
      ganho.gain.exponentialRampToValueAtTime(0.0001, agora + inicio + 0.13);

      osc.start(agora + inicio);
      osc.stop(agora + inicio + 0.14);
    }

    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Navegador que exige gesto do usuário antes de tocar áudio. A lista
    // continua funcionando; o som volta assim que alguém tocar em qualquer
    // botão. Não vale quebrar o salão por causa de um bipe.
  }
}
