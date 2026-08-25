'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { criarProduto } from '@/app/app/(cardapio)/cardapio/actions';
import type { CategoriaDoEditor } from '@/lib/cardapio/queries';

/**
 * Criar item.
 *
 * O campo de preço só aparece para quem tem `menu.price`. Para os demais o item
 * nasce sem preço e a tela diz isso — mostrar um campo que o banco vai recusar
 * faz a pessoa digitar, salvar e só então descobrir. A recusa continua
 * existindo no banco de qualquer forma; isto é só não fazer perder tempo.
 *
 * Todo item nasce FORA DO AR. Sem isso ele apareceria no celular do cliente no
 * segundo em que alguém aperta "criar" — antes da foto, antes da descrição.
 */
export function NovoItem({
  categorias,
  podePrecificar,
  onFechar,
}: {
  categorias: CategoriaDoEditor[];
  podePrecificar: boolean;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const disponiveis = categorias.filter((c) => !c.arquivada);

  function enviar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = await criarProduto(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      onFechar();
      router.push(`/app/cardapio/${r.id}`);
    });
  }

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        <SheetTitle>Novo item</SheetTitle>

        <form action={enviar} className="mt-3 space-y-3">
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Nome</span>
            <input
              name="nome"
              required
              maxLength={120}
              autoFocus
              className="mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Categoria</span>
            <select
              name="categoriaId"
              required
              className="mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {disponiveis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>

          {podePrecificar ? (
            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">
                Preço (R$)
              </span>
              <input
                name="preco"
                inputMode="decimal"
                placeholder="0,00"
                defaultValue="0"
                className="tabular mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </label>
          ) : (
            <p className="rounded-md bg-secondary px-3 py-2 text-[12px] text-muted-foreground">
              O item vai nascer sem preço. Quem tem permissão de preço precifica
              depois.
            </p>
          )}

          {erro && (
            <p role="alert" className="text-[13px] text-alert-critical">
              {erro}
            </p>
          )}

          <p className="text-[12px] text-muted-foreground">
            Nasce fora do ar. Você liga quando estiver pronto.
          </p>

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
              {pendente ? 'Criando…' : 'Criar'}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
