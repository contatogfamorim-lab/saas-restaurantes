'use client';

import { useId, useState } from 'react';

/**
 * O rótulo de um campo, com a explicação escondida atrás de um (?).
 *
 * Antes, cada campo trazia duas ou três linhas de texto embaixo. Somadas, elas
 * eram a maior parte das telas de gestão — e quem usa o sistema todo dia já
 * sabe o que é "taxa de serviço". Aquilo atrapalhava a leitura para sempre por
 * causa de uma dúvida que existe uma vez.
 *
 * A explicação continua existindo e para de ocupar espaço.
 *
 * É um botão de verdade, e não um `title`: `title` não aparece no celular, não
 * abre pelo teclado e nenhum leitor de tela promete lê-lo. E o texto fica
 * SEMPRE no DOM — visível quando aberto, `sr-only` quando fechado — para que
 * quem usa leitor de tela não dependa de descobrir que há um botão ali.
 */
export function RotuloComAjuda({
  children,
  ajuda,
}: {
  children: React.ReactNode;
  /** Uma frase, curta. Se precisar de duas, o campo provavelmente está errado. */
  ajuda?: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  const id = useId();

  if (!ajuda) {
    return <span className="text-[12px] font-semibold text-muted-foreground">{children}</span>;
  }

  return (
    <>
      <span className="flex items-center gap-1.5">
        <span className="text-[12px] font-semibold text-muted-foreground">{children}</span>
        <button
          type="button"
          onClick={() => setAberta((v) => !v)}
          aria-expanded={aberta}
          aria-controls={id}
          aria-label={aberta ? 'Esconder a explicação' : 'O que é isto?'}
          className="grid size-4 shrink-0 place-items-center rounded-full border border-border text-[10px] font-bold leading-none text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
        >
          ?
        </button>
      </span>

      <span
        id={id}
        className={
          aberta
            ? 'mt-1 block text-[11px] leading-snug text-muted-foreground'
            : 'sr-only'
        }
      >
        {ajuda}
      </span>
    </>
  );
}
