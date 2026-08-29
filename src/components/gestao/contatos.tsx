'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { sincronizarContatos } from '@/app/app/(gestao)/gestao/contatos/actions';

/**
 * A agenda do aparelho.
 *
 * Portado do `app/api/evolution/contacts` do markello CRM, que lá servia para
 * casar contato com lead. Aqui a agenda é uma lista sua, e a coisa mais
 * importante da tela é o aviso de que ela NÃO é a lista de disparo.
 */

export interface ContatoNaTela {
  id: string;
  jid: string;
  fone: string | null;
  nome: string | null;
  foto: string | null;
  vistoEm: string;
}

export function Contatos({ contatos }: { contatos: ContatoNaTela[] }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [busca, setBusca] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return contatos;
    return contatos.filter(
      (c) =>
        (c.nome ?? '').toLowerCase().includes(q) ||
        (c.fone ?? '').includes(q.replace(/\D/g, '')),
    );
  }, [contatos, busca]);

  function sincronizar() {
    setAviso(null);
    iniciar(async () => {
      const r = await sincronizarContatos();
      if (!r.ok) {
        setAviso(r.erro ?? 'Não deu certo');
        return;
      }
      // Zero tem explicação própria, e é a mais provável nesta casa: a agenda
      // só vem quando o aparelho é pareado com o histórico ligado.
      setAviso(
        r.quantos === 0
          ? 'A Evolution não devolveu contato nenhum. A agenda só vem no pareamento — desconecte e leia o QR de novo para trazê-la.'
          : `${r.quantos} contatos atualizados.`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou telefone"
          className="h-10 min-w-56 flex-1 rounded-md border border-border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
        <button
          type="button"
          onClick={sincronizar}
          disabled={pendente}
          className="h-10 shrink-0 rounded-md border border-border px-3 text-[13px] disabled:opacity-50"
        >
          {pendente ? 'Buscando…' : 'Buscar da Evolution'}
        </button>
      </div>

      {aviso && (
        <p className="mt-2 rounded-md bg-secondary px-3 py-2 text-[12px] leading-snug">
          {aviso}
        </p>
      )}

      <p className="mt-3 rounded-md bg-alert-warn/10 px-3 py-2 text-[12px] leading-snug text-alert-warn">
        <strong>Esta lista não recebe campanha.</strong> É a agenda do celular —
        tem cliente, mas tem fornecedor e parente também, e ninguém aqui
        autorizou promoção. Quem recebe é só quem marcou o aceite no cadastro.
      </p>

      {filtrados.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
          {contatos.length === 0
            ? 'Nenhum contato ainda.'
            : 'Nada encontrado para esta busca.'}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
          {filtrados.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">
                  {c.nome ?? formatarFone(c.fone) ?? c.jid.replace(/@.*$/, '')}
                </p>
                {c.nome && (
                  <p className="text-[11px] text-muted-foreground">
                    {formatarFone(c.fone) ?? c.jid.replace(/@.*$/, '')}
                  </p>
                )}
              </div>
              <Link
                href={`/app/gestao/conversas?jid=${encodeURIComponent(c.jid)}`}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-secondary"
              >
                Conversa
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {contatos.length} na agenda
        {filtrados.length !== contatos.length && `, ${filtrados.length} nesta busca`}.
      </p>
    </>
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
