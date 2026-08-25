'use client';

import { useState, useTransition } from 'react';
import { PlusIcon, PrinterIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { criarMesas } from '@/app/comecar/actions';
import { useRouter } from 'next/navigation';

export interface MesaImpressa {
  id: string;
  label: string;
  area: string;
  lugares: number | null;
  shortCode: string;
  ativa: boolean;
  svg: string;
  url: string;
}

/**
 * A folha de mesas (spec §14).
 *
 * Duas leituras da mesma página: na tela é uma lista de gestão; no papel é o
 * adesivo que vai para cada mesa. `print:` do Tailwind resolve as duas sem
 * manter uma segunda página só para impressão — que é a versão que sempre fica
 * desatualizada.
 */
export function FolhaDeMesas({
  mesas,
  restaurante,
}: {
  mesas: MesaImpressa[];
  restaurante: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  function adicionar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = await criarMesas(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      setCriando(false);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-bold text-accent-foreground"
        >
          <PrinterIcon className="size-3.5" />
          Imprimir os códigos
        </button>

        <button
          type="button"
          onClick={() => setCriando((v) => !v)}
          className="flex h-9 items-center gap-1.5 rounded-md bg-secondary px-3 text-[12px] font-semibold"
        >
          <PlusIcon className="size-3.5" />
          Mais mesas
        </button>

        <p className="text-[12px] text-muted-foreground">
          Cole o código na mesa. Quem sentar aponta a câmera e o cardápio abre —
          sem instalar nada.
        </p>
      </div>

      {criando && (
        <form
          action={adicionar}
          className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3 print:hidden"
        >
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Quantas
            </span>
            <input
              name="quantidade"
              type="number"
              min={1}
              max={200}
              defaultValue={4}
              className="tabular mt-1 h-10 w-24 rounded-md border border-border bg-card px-2 text-[14px]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground">Área</span>
            <input
              name="area"
              defaultValue="Salão"
              maxLength={40}
              className="mt-1 h-10 w-40 rounded-md border border-border bg-card px-2 text-[14px]"
            />
          </label>
          <button
            type="submit"
            disabled={pendente}
            className="h-10 rounded-md bg-accent px-3 text-[13px] font-bold text-accent-foreground disabled:opacity-50"
          >
            {pendente ? 'Criando…' : 'Criar'}
          </button>
          {erro && <p className="text-[12px] text-alert-critical">{erro}</p>}
        </form>
      )}

      {mesas.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma mesa ainda.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-0">
          {mesas.map((mesa) => (
            <article
              key={mesa.id}
              className={cn(
                'rounded-lg border border-border bg-card p-4 text-center',
                // Não parte um adesivo entre duas folhas.
                'print:break-inside-avoid print:border-2 print:border-dashed print:bg-white print:text-black',
                !mesa.ativa && 'opacity-50 print:hidden',
              )}
            >
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground print:text-black">
                {restaurante}
              </p>
              <p className="font-display text-2xl leading-tight">{mesa.label}</p>
              {mesa.area && (
                <p className="text-[11px] text-muted-foreground print:text-black">
                  {mesa.area}
                </p>
              )}

              {/* O SVG vem pronto do servidor. `dangerouslySetInnerHTML` aqui é
                  seguro no sentido que importa: a string é gerada por
                  `lib/mesas/qr.ts` a partir de uma URL que o servidor monta —
                  nada dela vem do usuário. */}
              <div
                className="mx-auto mt-3 aspect-square w-full max-w-56 [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: mesa.svg }}
              />

              {/* O código escrito por extenso: no dia em que a câmera não ler —
                  tela rachada, lente suja, luz baixa — alguém digita. */}
              <p className="tabular mt-2 text-[15px] font-bold tracking-[0.2em]">
                {mesa.shortCode}
              </p>
              <p className="mt-0.5 break-all text-[10px] text-muted-foreground print:text-black">
                {mesa.url}
              </p>

              {!mesa.ativa && (
                <p className="mt-1 text-[11px] font-semibold text-alert-warning">
                  desativada
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
