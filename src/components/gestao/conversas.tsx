'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  enviarMensagem,
  marcarLida,
} from '@/app/app/(gestao)/gestao/conversas/actions';

/**
 * A caixa de entrada, em duas colunas: as conversas à esquerda, a aberta à
 * direita. Portado do `ChatPanel` do markello CRM, bem mais enxuto — lá o
 * painel também faz IA, anexo e etiqueta de lead.
 *
 * O QUE NÃO TEM, E É PROPOSITAL
 *
 * Não há tempo real. A conversa atualiza ao trocar de conversa, ao enviar e ao
 * recarregar. Realtime aqui exigiria assinar a tabela por casa, e é trabalho
 * de verdade — prometer "chegou agora" e entregar "chegou quando você clicou"
 * seria pior que a página não prometer nada.
 *
 * Não há envio de imagem nem áudio: mídia que CHEGA aparece como `[audio]`, e
 * mídia que sai não existe. Meia implementação faria a conversa parecer
 * completa sem estar.
 */

export interface ConversaResumo {
  jid: string;
  nome: string | null;
  fone: string | null;
  ultimoCorpo: string;
  ultimaDirecao: string;
  ultimaEm: string;
  naoLidas: number;
}

export interface MensagemNaTela {
  id: string;
  direcao: 'entrada' | 'saida';
  corpo: string;
  midia: string | null;
  status: string;
  em: string;
}

export function Conversas({
  conversas,
  aberta,
  mensagens,
  podeEnviar,
}: {
  conversas: ConversaResumo[];
  aberta: string | null;
  mensagens: MensagemNaTela[];
  podeEnviar: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  const atual = conversas.find((c) => c.jid === aberta) ?? null;

  // Rolar para o fim ao abrir: uma conversa que abre no topo obriga a rolar
  // até embaixo para ver o que acabou de chegar, que é o que interessa.
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [aberta, mensagens.length]);

  // Abrir uma conversa marca o que chegou como lido. Faz parte de abrir —
  // um botão "marcar como lida" seria trabalho manual para registrar o óbvio.
  useEffect(() => {
    if (!aberta || !atual?.naoLidas) return;
    void marcarLida(aberta);
  }, [aberta, atual?.naoLidas]);

  function enviar() {
    if (!aberta || !texto.trim()) return;
    setErro(null);
    const corpo = texto;
    setTexto('');
    iniciar(async () => {
      const r = await enviarMensagem(aberta, corpo);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        setTexto(corpo); // devolve o texto: perder o que foi escrito é imperdoável
        return;
      }
      router.refresh();
    });
  }

  if (conversas.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-[13px] leading-relaxed text-muted-foreground">
        Nenhuma conversa ainda.
        <br />
        As mensagens aparecem aqui conforme chegam no número da casa.
      </p>
    );
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* ── a lista ── */}
      <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-border">
        {conversas.map((c) => (
          <button
            key={c.jid}
            type="button"
            onClick={() => router.push(`/app/gestao/conversas?jid=${encodeURIComponent(c.jid)}`)}
            className={`flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-secondary ${
              c.jid === aberta ? 'bg-secondary' : ''
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-semibold">
                  {c.nome ?? formatarFone(c.fone) ?? c.jid.replace(/@.*$/, '')}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {quando(c.ultimaEm)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {c.ultimaDirecao === 'saida' && <span className="mr-1">Você:</span>}
                {c.ultimoCorpo}
              </p>
            </div>
            {c.naoLidas > 0 && (
              <span className="mt-1 shrink-0 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-background">
                {c.naoLidas}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── a conversa aberta ── */}
      <div className="flex max-h-[70vh] flex-col rounded-xl border border-border">
        {atual && (
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-[14px] font-semibold">
              {atual.nome ?? formatarFone(atual.fone) ?? atual.jid.replace(/@.*$/, '')}
            </p>
            {atual.nome && atual.fone && (
              <p className="text-[11px] text-muted-foreground">{formatarFone(atual.fone)}</p>
            )}
          </div>
        )}

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {mensagens.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.direcao === 'saida' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap ${
                  m.direcao === 'saida'
                    ? 'bg-brand/15 text-foreground'
                    : 'bg-secondary text-foreground'
                }`}
              >
                {m.corpo}
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {quando(m.em)}
                  {m.direcao === 'saida' && m.status !== 'enviada' && ` · ${m.status}`}
                </span>
              </div>
            </div>
          ))}
          <div ref={fim} />
        </div>

        {podeEnviar && (
          <div className="border-t border-border p-3">
            {erro && (
              <p role="alert" className="mb-2 text-[12px] text-alert-critical">
                {erro}
              </p>
            )}
            <div className="flex gap-2">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  // Enter manda, Shift+Enter quebra linha — como no WhatsApp.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    enviar();
                  }
                }}
                rows={2}
                maxLength={4096}
                placeholder="Escreva…"
                className="min-h-11 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <button
                type="button"
                onClick={enviar}
                disabled={pendente || !texto.trim()}
                className="h-11 shrink-0 rounded-md bg-brand px-4 text-[13px] font-semibold text-background disabled:opacity-40"
              >
                {pendente ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** `5511987654321` → `(11) 98765-4321`. Devolve o cru se não reconhecer. */
function formatarFone(fone: string | null): string | null {
  if (!fone) return null;
  const d = fone.replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return fone;
}

/** Hoje mostra a hora; antes disso, a data. */
function quando(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia =
    d.getDate() === hoje.getDate() &&
    d.getMonth() === hoje.getMonth() &&
    d.getFullYear() === hoje.getFullYear();

  return mesmoDia
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
