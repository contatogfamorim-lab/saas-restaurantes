import { Suspense } from 'react';

import { SeletorPeriodo } from './seletor-periodo';

/**
 * Cabeçalho de seção: o que é esta tela, e de que recorte de tempo ela fala.
 *
 * O período fica sempre no mesmo lugar, em todas as seções — trocar de posição
 * entre telas faria o dono procurar o controle a cada navegação.
 */
export function Cabecalho({
  titulo,
  descricao,
  comPeriodo = true,
}: {
  titulo: string;
  descricao: string;
  comPeriodo?: boolean;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-xl leading-none">{titulo}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{descricao}</p>
      </div>
      {comPeriodo && (
        <Suspense fallback={<div className="h-7 w-24" />}>
          <SeletorPeriodo />
        </Suspense>
      )}
    </header>
  );
}
