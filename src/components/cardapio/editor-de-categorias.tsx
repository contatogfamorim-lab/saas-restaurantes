'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ClockIcon, PlusIcon } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { salvarCategoria } from '@/app/app/(cardapio)/cardapio/actions';
import type { CategoriaDoEditor } from '@/lib/cardapio/queries';

export function EditorDeCategorias({ categorias }: { categorias: CategoriaDoEditor[] }) {
  const [editando, setEditando] = useState<CategoriaDoEditor | 'nova' | null>(null);

  const ativas = categorias.filter((c) => !c.arquivada);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground">
          A ordem daqui é a ordem que o cliente vê no celular.
        </p>
        <button
          type="button"
          onClick={() => setEditando('nova')}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 text-[13px] font-bold text-background"
        >
          <PlusIcon className="size-4" />
          Nova
        </button>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {ativas.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setEditando(c)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/50"
            >
              <span className="tabular w-6 shrink-0 text-[12px] text-muted-foreground">
                {c.ordem}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold leading-tight">
                  {c.nome}
                </span>
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  {c.itens} {c.itens === 1 ? 'item' : 'itens'} · {c.estacao}
                  {c.disponivelDe && c.disponivelAte && (
                    <>
                      <ClockIcon className="size-3" />
                      {c.disponivelDe.slice(0, 5)}–{c.disponivelAte.slice(0, 5)}
                    </>
                  )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {ativas.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma categoria ainda.
        </p>
      )}

      {editando && (
        <FormularioDeCategoria
          categoria={editando === 'nova' ? null : editando}
          onFechar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function FormularioDeCategoria({
  categoria,
  onFechar,
}: {
  categoria: CategoriaDoEditor | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [comJanela, setComJanela] = useState(Boolean(categoria?.disponivelDe));

  function enviar(formData: FormData) {
    setErro(null);

    // Sem janela, as duas pontas vão vazias — o CHECK da tabela exige as duas
    // ou nenhuma, e mandar só uma daria erro de constraint na cara do usuário.
    if (!comJanela) {
      formData.set('de', '');
      formData.set('ate', '');
    }

    iniciar(async () => {
      const r = await salvarCategoria(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      onFechar();
      router.refresh();
    });
  }

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        <SheetTitle>{categoria ? categoria.nome : 'Nova categoria'}</SheetTitle>

        <form action={enviar} className="mt-3 space-y-3">
          {categoria && <input type="hidden" name="id" value={categoria.id} />}

          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Nome</span>
            <input
              name="nome"
              defaultValue={categoria?.nome ?? ''}
              required
              maxLength={80}
              autoFocus={!categoria}
              className="mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">Ordem</span>
              <input
                name="ordem"
                type="number"
                min={0}
                max={999}
                defaultValue={categoria?.ordem ?? 0}
                className="tabular mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </label>

            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">Estação</span>
              <select
                name="estacao"
                defaultValue={categoria?.estacao ?? 'cozinha'}
                className="mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <option value="cozinha">Cozinha</option>
                <option value="bar">Bar</option>
              </select>
            </label>
          </div>

          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={comJanela}
                onChange={(e) => setComJanela(e.target.checked)}
                className="size-4"
              />
              <span className="text-[13px] font-semibold">Só em certo horário</span>
            </label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Fora da janela, a seção inteira some do cardápio do cliente.
            </p>

            {comJanela && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] text-muted-foreground">Das</span>
                  <input
                    name="de"
                    type="time"
                    defaultValue={categoria?.disponivelDe?.slice(0, 5) ?? '11:00'}
                    className="tabular mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] text-muted-foreground">às</span>
                  <input
                    name="ate"
                    type="time"
                    defaultValue={categoria?.disponivelAte?.slice(0, 5) ?? '15:00'}
                    className="tabular mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px]"
                  />
                </label>
              </div>
            )}
          </div>

          {erro && (
            <p role="alert" className="text-[13px] text-alert-critical">
              {erro}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onFechar}
              className="h-11 flex-1 rounded-md bg-secondary text-[14px] font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pendente}
              className="h-11 flex-1 rounded-md bg-brand text-[14px] font-bold text-background disabled:opacity-50"
            >
              {pendente ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
