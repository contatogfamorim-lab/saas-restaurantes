'use client';

import { useActionState } from 'react';
import { EyeIcon } from 'lucide-react';

import { revelarTelefone } from '@/app/app/(gestao)/gestao/clientes/actions';

/**
 * Telefone mascarado com um botão para ver o número inteiro (spec §10.9).
 *
 * Um por linha, e não um "mostrar todos": revelar em lote transformaria a
 * auditoria numa linha só dizendo "olhou tudo", que é o mesmo que não ter
 * auditoria. Assim cada número revelado tem um registro com hora e autor.
 *
 * O aviso de que o acesso fica registrado está no botão, não escondido num
 * rodapé. Quem clica sabendo se comporta diferente de quem descobre depois.
 */
export function Telefone({
  guestId,
  mascarado,
}: {
  guestId: string;
  mascarado: string | null;
}) {
  const [estado, acao, pendente] = useActionState(revelarTelefone, null);

  if (!mascarado) {
    return <span className="text-[12px] text-muted-foreground">não deixou</span>;
  }

  if (estado?.telefone) {
    return <span className="tabular-nums text-[13px]">{estado.telefone}</span>;
  }

  return (
    <form action={acao} className="flex items-center gap-2">
      <input type="hidden" name="guestId" value={guestId} />
      <span className="tabular-nums text-[13px] text-muted-foreground">{mascarado}</span>
      <button
        type="submit"
        disabled={pendente}
        title="Ver o número completo. O acesso fica registrado na auditoria."
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        <EyeIcon className="size-3.5" />
        <span className="sr-only">Ver telefone completo de {mascarado}</span>
      </button>
      {estado?.erro && (
        <span className="text-[11px] text-alert-critical">{estado.erro}</span>
      )}
    </form>
  );
}
