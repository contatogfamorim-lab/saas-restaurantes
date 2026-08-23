'use client';

import { useState } from 'react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

/**
 * Identificação do cliente — pedida no PRIMEIRO envio, nunca antes (spec §4).
 *
 * Nome é obrigatório porque a cozinha e o garçom precisam saber de quem é o
 * prato. Telefone é opcional por padrão: é dado pessoal, e a §10.9 manda
 * minimizar. Vira obrigatório só quando o restaurante liga `require_phone`.
 *
 * O consentimento LGPD é registrado com timestamp no banco, e só existe se a
 * pessoa marcar. Sem marcar, o telefone é descartado no servidor — não fica
 * "guardado por precaução", que é exatamente o que gera multa.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantName: string;
  requirePhone: boolean;
  enviando: boolean;
  erro: string | null;
  onConfirm: (dados: { nome: string; telefone?: string; consentimento: boolean }) => void;
}

export function IdentifySheet({
  open,
  onOpenChange,
  restaurantName,
  requirePhone,
  enviando,
  erro,
  onConfirm,
}: Props) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [consentimento, setConsentimento] = useState(false);

  const telefoneLimpo = telefone.replace(/\D/g, '');
  const telefoneValido = telefoneLimpo.length === 0 || telefoneLimpo.length >= 10;
  const podeEnviar =
    nome.trim().length > 0 &&
    telefoneValido &&
    (!requirePhone || telefoneLimpo.length >= 10) &&
    // telefone só sai daqui com consentimento marcado
    (telefoneLimpo.length === 0 || consentimento);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
      >
        <form
          className="px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!podeEnviar || enviando) return;
            onConfirm({
              nome: nome.trim(),
              telefone: telefoneLimpo || undefined,
              consentimento,
            });
          }}
        >
          <SheetTitle className="font-display text-2xl leading-tight">
            Como te chamamos?
          </SheetTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            O garçom precisa saber de quem é o pedido.
          </p>

          <label htmlFor="nome" className="mt-5 block text-sm font-medium">
            Seu nome
          </label>
          <input
            id="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={60}
            autoComplete="given-name"
            autoFocus
            enterKeyHint="done"
            placeholder="Como preferir ser chamado"
            className="mt-1.5 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />

          <label htmlFor="tel" className="mt-4 block text-sm font-medium">
            Telefone{' '}
            <span className="font-normal text-muted-foreground">
              {requirePhone ? '(obrigatório aqui)' : '(opcional)'}
            </span>
          </label>
          <input
            id="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            type="tel"
            inputMode="tel"
            maxLength={24}
            autoComplete="tel"
            placeholder="(11) 90000-0000"
            className="mt-1.5 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />

          {telefoneLimpo.length > 0 && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={consentimento}
                onChange={(e) => setConsentimento(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="text-[13px] leading-snug text-muted-foreground">
                Autorizo {restaurantName} a guardar meu telefone para contato
                sobre este pedido.{' '}
                <a
                  href="/privacidade"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  Como usamos seus dados
                </a>
              </span>
            </label>
          )}

          {erro && (
            <p role="alert" className="mt-4 text-[13px] text-destructive">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={!podeEnviar || enviando}
            className="mt-5 h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            {enviando ? 'Enviando…' : 'Enviar pedido'}
          </button>

          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            Sem cadastro, sem senha. Só o nome.
          </p>
        </form>
      </SheetContent>
    </Sheet>
  );
}
