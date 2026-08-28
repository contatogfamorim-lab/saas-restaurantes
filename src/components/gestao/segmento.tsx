'use client';

import { useEffect, useState, useTransition } from 'react';

import { cn } from '@/lib/utils';
import { contarSegmento } from '@/app/app/(gestao)/gestao/campanhas/actions';

export interface Segmento {
  tipo: 'todos' | 'com_saldo' | 'sumidos' | 'melhores';
  dias?: number;
  min_cents?: number;
}

const OPCOES: {
  tipo: Segmento['tipo'];
  rotulo: string;
  explica: string;
  campo?: 'dias' | 'reais';
  padrao?: number;
}[] = [
  {
    tipo: 'todos',
    rotulo: 'Todo mundo',
    explica: 'Quem aceitou receber. Certo para horário novo, feriado, evento grande.',
  },
  {
    tipo: 'com_saldo',
    rotulo: 'Com cashback guardado',
    explica:
      'Quem tem dinheiro parado aqui. É o grupo que já pagou por um motivo para voltar.',
    campo: 'reais',
    padrao: 10,
  },
  {
    tipo: 'sumidos',
    rotulo: 'Sumidos',
    explica: 'Quem já veio e parou de vir. Nunca inclui quem nunca apareceu.',
    campo: 'dias',
    padrao: 60,
  },
  {
    tipo: 'melhores',
    rotulo: 'Quem mais gasta',
    explica:
      'Para o convite que não cabe a todo mundo. O valor é o da COMANDA em que a pessoa esteve — quem sempre vem acompanhado aparece maior do que gastou.',
    campo: 'reais',
    padrao: 200,
  },
];

/**
 * Escolher para quem a campanha vai.
 *
 * O NÚMERO é o conteúdo desta tela. Um seletor que não diz quantas pessoas
 * aquilo alcança é um seletor que não ajuda a decidir nada — e "todo mundo"
 * continua sendo a escolha mais fácil justamente porque é a única cujo tamanho
 * a pessoa consegue imaginar.
 *
 * A contagem vem do servidor, da MESMA função que monta o público. Estimar
 * aqui seria mais rápido e prometeria um número que a fila não cumpre.
 */
export function SeletorDeSegmento({
  valor,
  onChange,
}: {
  valor: Segmento;
  onChange: (s: Segmento) => void;
}) {
  const [quantos, setQuantos] = useState<number | null>(null);
  const [contando, iniciar] = useTransition();

  useEffect(() => {
    iniciar(async () => {
      const n = await contarSegmento(valor);
      setQuantos(n);
    });
  }, [valor]);

  const atual = OPCOES.find((o) => o.tipo === valor.tipo) ?? OPCOES[0];

  return (
    <div>
      <p className="text-[12px] font-semibold text-muted-foreground">Para quem</p>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {OPCOES.map((o) => (
          <button
            key={o.tipo}
            type="button"
            onClick={() =>
              onChange(
                o.campo === 'reais'
                  ? { tipo: o.tipo, min_cents: (o.padrao ?? 0) * 100 }
                  : o.campo === 'dias'
                    ? { tipo: o.tipo, dias: o.padrao }
                    : { tipo: o.tipo },
              )
            }
            className={cn(
              'h-9 rounded-lg border px-3 text-[13px]',
              valor.tipo === o.tipo
                ? 'border-brand bg-brand/10 font-medium'
                : 'border-border bg-background',
            )}
          >
            {o.rotulo}
          </button>
        ))}
      </div>

      {atual.campo === 'dias' && (
        <label className="mt-2 flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">sem vir há</span>
          <input
            value={String(valor.dias ?? atual.padrao ?? 60)}
            onChange={(e) =>
              onChange({
                ...valor,
                dias: Math.max(Number(e.target.value.replace(/\D/g, '')) || 1, 1),
              })
            }
            inputMode="numeric"
            className="h-9 w-20 rounded-lg border border-border bg-background px-2 text-[14px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          <span className="text-[13px] text-muted-foreground">dias</span>
        </label>
      )}

      {atual.campo === 'reais' && (
        <label className="mt-2 flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">
            {valor.tipo === 'com_saldo' ? 'saldo de pelo menos' : 'gastou pelo menos'}
          </span>
          <span className="text-[13px] text-muted-foreground">R$</span>
          <input
            value={String(Math.round((valor.min_cents ?? 0) / 100))}
            onChange={(e) =>
              onChange({
                ...valor,
                min_cents: (Number(e.target.value.replace(/\D/g, '')) || 0) * 100,
              })
            }
            inputMode="numeric"
            className="h-9 w-24 rounded-lg border border-border bg-background px-2 text-[14px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          {valor.tipo === 'melhores' && (
            <span className="text-[13px] text-muted-foreground">nos últimos 180 dias</span>
          )}
        </label>
      )}

      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        {atual.explica}
      </p>

      {/*
        O número, grande o bastante para ser visto antes do clique.
        `quantos === 0` é informação, não erro: significa que ninguém casa com o
        filtro, e o disparo vai recusar — melhor descobrir aqui.
      */}
      <p
        className={cn(
          'mt-2 text-[14px]',
          quantos === 0 ? 'text-alert-warning' : 'text-foreground',
        )}
      >
        {contando || quantos === null ? (
          <span className="text-muted-foreground">contando…</span>
        ) : quantos === 0 ? (
          'Ninguém se encaixa neste filtro agora.'
        ) : (
          <>
            <strong>{quantos}</strong>{' '}
            {quantos === 1 ? 'pessoa recebe' : 'pessoas recebem'}
          </>
        )}
      </p>
    </div>
  );
}
