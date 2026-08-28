import Link from 'next/link';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface Passo {
  chave: string;
  titulo: string;
  feito: boolean;
  detalhe: string;
  onde: string;
  essencial: boolean;
  porque: string;
}

/**
 * O painel de configurações iniciais.
 *
 * Componente de SERVIDOR: não há estado nenhum aqui — o estado é o banco, e a
 * página relê a cada visita. Um `useState` guardando "já fiz isso" seria a
 * caixinha manual voltando pela porta dos fundos.
 *
 * A separação entre ESSENCIAL e o resto é o que faz o painel ser útil em vez de
 * assustador. Sem mesa e sem cardápio o sistema não funciona; sem estoque e sem
 * WhatsApp ele funciona e faz menos. Misturar os dois numa lista de oito itens
 * faria alguém achar que precisa de tudo antes de abrir a casa.
 */
export function PainelDeConfiguracao({
  passos,
  restaurante,
}: {
  passos: Passo[];
  restaurante: string;
}) {
  const essenciais = passos.filter((p) => p.essencial);
  const extras = passos.filter((p) => !p.essencial);
  const faltaEssencial = essenciais.filter((p) => !p.feito).length;
  const prontos = passos.filter((p) => p.feito).length;

  return (
    <>
      <div className="mb-5 rounded-xl border border-border bg-card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-[17px]">
            {faltaEssencial === 0
              ? `${restaurante} está pronto para receber pedidos`
              : faltaEssencial === 1
                ? 'Falta uma coisa para a casa abrir'
                : `Faltam ${faltaEssencial} coisas para a casa abrir`}
          </p>
          <p className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
            {prontos} de {passos.length}
          </p>
        </div>

        <div className="mt-3 flex gap-1">
          {passos.map((p) => (
            <div
              key={p.chave}
              title={p.titulo}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                p.feito ? 'bg-brand' : p.essencial ? 'bg-alert-warning/50' : 'bg-muted',
              )}
            />
          ))}
        </div>
      </div>

      <Grupo
        titulo="Sem isto o sistema não funciona"
        passos={essenciais}
      />

      <Grupo
        titulo="Isto faz o sistema render mais"
        passos={extras}
        nota="Nada aqui impede a casa de abrir hoje. São as partes que trabalham sozinhas depois de configuradas."
      />
    </>
  );
}

function Grupo({
  titulo,
  passos,
  nota,
}: {
  titulo: string;
  passos: Passo[];
  nota?: string;
}) {
  if (passos.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="text-[12px] font-bold tracking-wide text-muted-foreground uppercase">
        {titulo}
      </h2>
      {nota && (
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{nota}</p>
      )}

      <ul className="mt-2 space-y-2">
        {passos.map((p) => (
          <li key={p.chave}>
            <Link
              href={p.onde}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 transition-colors',
                p.feito
                  ? 'border-border bg-card hover:bg-secondary/40'
                  : 'border-brand/40 bg-brand/5 hover:bg-brand/10',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                  p.feito ? 'bg-brand text-background' : 'border border-brand/50',
                )}
              >
                {p.feito && <CheckIcon className="size-3" />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{p.titulo}</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {p.detalhe}
                </span>
                {/*
                  O PORQUÊ aparece só no que falta. Em cima do que já está
                  feito seria texto que ninguém lê — e a tela já é longa.
                */}
                {!p.feito && (
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
                    {p.porque}
                  </span>
                )}
              </span>

              <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
