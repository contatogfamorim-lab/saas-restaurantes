'use client';

import { useState, useTransition } from 'react';

import { cn } from '@/lib/utils';
import { renderMensagem } from '@/lib/marketing/mensagem';
import { salvarGatilho } from '@/app/app/(gestao)/gestao/campanhas/actions';

export interface Gatilho {
  kind: 'liberou' | 'vai_expirar' | 'sumido';
  ativo: boolean;
  corpo: string;
  dias: number;
  /** Quantas já saíram por este gatilho, para a tela não ser só promessa. */
  enviadas: number;
}

const SOBRE: Record<
  Gatilho['kind'],
  { titulo: string; quando: string; porque: string }
> = {
  liberou: {
    titulo: 'Cashback liberado',
    quando: 'assim que o saldo sai da carência',
    porque:
      'A pessoa tem dinheiro parado aqui e não sabe. É o aviso mais fácil de justificar dos três, e o que costuma trazer gente de volta sem desconto nenhum.',
  },
  vai_expirar: {
    titulo: 'Cashback expirando',
    quando: 'sete dias antes de o saldo sumir',
    porque:
      'Só faz sentido se você ligou a validade do cashback. Avisar é obrigação de quem vai tirar — expirar sem avisar é o tipo de coisa que faz alguém não voltar mais.',
  },
  sumido: {
    titulo: 'Sentimos sua falta',
    quando: 'quando alguém que já veio some por um tempo',
    porque:
      'É o único dos três que é promoção pura, e o mais fácil de exagerar. Vai só para quem JÁ esteve na casa — para quem nunca veio, a frase é mentira e soa como tal.',
  },
};

export function Gatilhos({
  gatilhos,
  temValidade,
  tetoPorPessoa,
}: {
  gatilhos: Gatilho[];
  temValidade: boolean;
  tetoPorPessoa: number;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[17px]">Avisos automáticos</h2>
        <p className="text-[12px] text-muted-foreground">
          no máximo {tetoPorPessoa} por pessoa a cada 30 dias
        </p>
      </div>

      <div className="space-y-2">
        {gatilhos.map((g) => (
          <Cartao key={g.kind} gatilho={g} temValidade={temValidade} />
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Entram na <strong>mesma fila</strong> das campanhas escritas à mão, com
        as mesmas regras. Ninguém recebe duas vezes pelo mesmo motivo.
      </p>
    </div>
  );
}

function Cartao({ gatilho: g, temValidade }: { gatilho: Gatilho; temValidade: boolean }) {
  const [pendente, iniciar] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [corpo, setCorpo] = useState(g.corpo);
  const [dias, setDias] = useState(String(g.dias));
  const [erro, setErro] = useState<string | null>(null);

  const info = SOBRE[g.kind];
  // Ligar "vai expirar" sem validade configurada é ligar um aviso que nunca
  // dispara. A tela diz isso em vez de deixar a pessoa esperando.
  const inutil = g.kind === 'vai_expirar' && !temValidade;

  function salvar(ativo: boolean) {
    setErro(null);
    iniciar(async () => {
      const r = await salvarGatilho(g.kind, ativo, corpo, Number(dias) || 60);
      if (!r.ok) setErro(r.erro ?? 'Não deu certo');
    });
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        g.ativo ? 'border-brand/40 bg-brand/5' : 'border-border bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={g.ativo}
          disabled={pendente || inutil}
          onChange={(e) => salvar(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-[var(--color-brand)] disabled:opacity-40"
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setAberto(!aberto)}
            className="block w-full text-left"
          >
            <span className="text-[14px] font-semibold">{info.titulo}</span>
            <span className="ml-2 text-[12px] text-muted-foreground">
              {info.quando}
            </span>
            {g.enviadas > 0 && (
              <span className="ml-2 text-[12px] text-brand">
                · {g.enviadas} {g.enviadas === 1 ? 'enviada' : 'enviadas'}
              </span>
            )}
          </button>

          {inutil && (
            <p className="mt-1 text-[12px] text-alert-warning">
              Sem validade do cashback nas Configurações, este aviso nunca sai.
            </p>
          )}

          {aberto && (
            <div className="mt-3">
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {info.porque}
              </p>

              {g.kind === 'sumido' && (
                <label className="mt-3 block">
                  <span className="text-[12px] font-semibold text-muted-foreground">
                    Considerar sumido depois de
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      value={dias}
                      onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      inputMode="numeric"
                      className="h-9 w-20 rounded-lg border border-border bg-background px-2 text-[14px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    />
                    <span className="text-[13px] text-muted-foreground">dias sem vir</span>
                  </div>
                </label>
              )}

              <label className="mt-3 block">
                <span className="text-[12px] font-semibold text-muted-foreground">
                  A mensagem
                </span>
                <textarea
                  value={corpo}
                  onChange={(e) => setCorpo(e.target.value)}
                  maxLength={900}
                  rows={3}
                  className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[14px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </label>

              <div className="mt-2 rounded-lg bg-secondary/60 p-2.5">
                <p className="text-[12px] leading-relaxed whitespace-pre-wrap">
                  {renderMensagem(
                    corpo || '…',
                    'Ana Paula',
                    2500,
                    'https://seurestaurante.com.br',
                    'aBcD1234',
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => salvar(g.ativo)}
                disabled={pendente || corpo.trim().length < 10}
                className="mt-2 h-9 rounded-lg bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40"
              >
                {pendente ? 'Salvando…' : 'Salvar texto'}
              </button>

              {erro && (
                <p role="alert" className="mt-2 text-[12px] text-alert-critical">
                  {erro}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
