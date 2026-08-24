'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import { PERIODOS } from '@/lib/gestao/periodo';

/**
 * Recorte de tempo, em links e não em botões.
 *
 * Link porque o período é ESTADO DE ENDEREÇO: o dono manda "olha o mês" para o
 * gerente colando a URL, volta pelo botão do navegador, deixa os 90 dias
 * aberto numa aba. Um `useState` com `router.replace` daria a mesma tela e
 * perderia as três coisas.
 */
export function SeletorPeriodo() {
  const caminho = usePathname();
  const params = useSearchParams();
  const atual = Number(params.get('periodo')) || 7;

  return (
    <div className="flex items-center gap-0.5 rounded-md bg-secondary p-0.5">
      {PERIODOS.map((dias) => (
        <Link
          key={dias}
          href={`${caminho}?periodo=${dias}`}
          aria-current={atual === dias ? 'true' : undefined}
          className={cn(
            'rounded px-2.5 py-1 text-[12px] font-semibold tabular-nums transition-colors',
            atual === dias
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {dias}d
        </Link>
      ))}
    </div>
  );
}
