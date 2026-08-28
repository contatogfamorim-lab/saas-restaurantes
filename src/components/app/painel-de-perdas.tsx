'use client';

import { useState, useTransition } from 'react';

import { cn } from '@/lib/utils';
import { deMilesimos, NOME_DA_UNIDADE } from '@/lib/estoque/unidades';
import { registrarPerda } from '@/app/app/(equipe)/perdas/actions';

interface Insumo {
  id: string;
  nome: string;
  unidade: string;
  quantidade: number;
}

interface Perda {
  id: string;
  nome: string;
  unidade: string;
  delta: number;
  motivo: string | null;
  quando: string;
}

/**
 * O que se perdeu, registrado por quem viu.
 *
 * A tela é para de pé, com o celular na mão. Três toques do começo ao fim:
 * escolher o insumo, dizer quanto, dizer o quê.
 *
 * O MOTIVO É OBRIGATÓRIO, e é a única exigência da tela. Perda sem motivo é um
 * número que ninguém consegue explicar depois — e "por que sumiram 4 kg de
 * queijo?" é a pergunta que este registro existe para responder. Os motivos
 * comuns viram botão para que digitar não seja o obstáculo: quem está com a
 * mão suja não digita "vencido", larga pra lá.
 */
const MOTIVOS = ['Venceu', 'Queimou', 'Caiu', 'Estragou', 'Erro no preparo'];

export function PainelDePerdas({
  insumos,
  recentes,
}: {
  insumos: Insumo[];
  recentes: Perda[];
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);

  const [insumoId, setInsumoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');

  const escolhido = insumos.find((i) => i.id === insumoId);

  function enviar() {
    setErro(null);
    setSalvo(null);
    iniciar(async () => {
      const r = await registrarPerda(insumoId, quantidade, motivo);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      setSalvo(`${escolhido?.nome ?? 'Insumo'} — anotado.`);
      setInsumoId('');
      setQuantidade('');
      setMotivo('');
    });
  }

  return (
    <main className="mx-auto max-w-lg px-4 pb-24 pt-5">
      <h1 className="font-display text-[26px] leading-tight">Perdas</h1>
      <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
        O que estragou, queimou ou caiu. Anotar aqui é o que impede o estoque de
        mentir depois.
      </p>

      {insumos.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-[14px] leading-relaxed text-muted-foreground">
          Nenhum insumo cadastrado ainda.
          <br />
          Quem administra a casa cadastra em Estoque.
        </p>
      ) : (
        <>
          <div className="mt-6">
            <p className="text-[13px] font-semibold">O que se perdeu?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {insumos.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => {
                    setInsumoId(i.id === insumoId ? '' : i.id);
                    setErro(null);
                  }}
                  className={cn(
                    'min-h-[3.5rem] rounded-xl border p-3 text-left transition-colors',
                    i.id === insumoId
                      ? 'border-brand bg-brand/10'
                      : 'border-border bg-card',
                  )}
                >
                  <span className="block text-[14px] leading-snug font-medium">
                    {i.nome}
                  </span>
                  <span className="mt-0.5 block text-[12px] tabular-nums text-muted-foreground">
                    tem {deMilesimos(i.quantidade)} {NOME_DA_UNIDADE[i.unidade]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {escolhido && (
            <>
              <label className="mt-6 block">
                <span className="text-[13px] font-semibold">
                  Quanto? ({NOME_DA_UNIDADE[escolhido.unidade]})
                </span>
                <input
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  placeholder="0"
                  className="mt-2 h-14 w-full rounded-xl border border-border bg-card px-4 text-[20px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </label>

              <div className="mt-6">
                <p className="text-[13px] font-semibold">O que aconteceu?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {MOTIVOS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMotivo(m)}
                      className={cn(
                        'h-11 rounded-xl border px-4 text-[14px]',
                        motivo === m
                          ? 'border-brand bg-brand/10 font-medium'
                          : 'border-border bg-card',
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={120}
                  placeholder="ou escreva"
                  className="mt-2 h-12 w-full rounded-xl border border-border bg-card px-4 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <button
                type="button"
                onClick={enviar}
                disabled={
                  pendente || quantidade.trim() === '' || motivo.trim().length < 3
                }
                className="mt-6 h-14 w-full rounded-xl bg-brand text-[16px] font-bold text-background disabled:opacity-40"
              >
                {pendente ? 'Anotando…' : 'Anotar perda'}
              </button>
            </>
          )}
        </>
      )}

      {erro && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-alert-critical/10 px-4 py-3 text-[14px] text-alert-critical"
        >
          {erro}
        </p>
      )}

      {salvo && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-brand/10 px-4 py-3 text-[14px] text-brand"
        >
          {salvo}
        </p>
      )}

      {recentes.length > 0 && (
        <div className="mt-10 border-t border-border pt-5">
          <p className="text-[12px] font-bold tracking-wide text-muted-foreground uppercase">
            Anotadas hoje e antes
          </p>
          <ul className="mt-2 space-y-2">
            {recentes.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-[14px]">
                  {p.nome}
                  {p.motivo && (
                    <span className="text-muted-foreground"> · {p.motivo}</span>
                  )}
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                  {deMilesimos(Math.abs(p.delta))} {NOME_DA_UNIDADE[p.unidade]}
                </span>
              </li>
            ))}
          </ul>
          {/*
            A lista existe para quem anotou ver que ficou anotado — e para a
            pessoa seguinte não anotar de novo a mesma coisa.
          */}
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            Já anotado não precisa ser anotado de novo.
          </p>
        </div>
      )}
    </main>
  );
}
