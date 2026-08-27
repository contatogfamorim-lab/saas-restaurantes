'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CameraOffIcon, SearchIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import type { CategoriaDoEditor, ProdutoDoEditor } from '@/lib/cardapio/queries';
import { alternarDisponibilidade } from '@/app/app/(equipe)/disponibilidade/actions';

/**
 * "Acabou" (spec §12).
 *
 * Uma decisão por item, tomada de pé. Por isso:
 *
 *  - o botão ocupa a metade direita da linha inteira e tem 56 px de altura —
 *    alvo de polegar em cozinha, não de mouse;
 *  - o que está FORA DO AR sobe para o topo, porque quem abre esta tela no meio
 *    do serviço quase sempre quer religar alguma coisa;
 *  - a mudança aparece na hora (`useOptimistic`) e volta atrás se o servidor
 *    recusar. Numa rede de restaurante, esperar 800 ms por um toque faz a
 *    pessoa tocar de novo — e o segundo toque desfaz o primeiro.
 */
export function PainelDeDisponibilidade({
  produtos,
  categorias,
}: {
  produtos: ProdutoDoEditor[];
  categorias: CategoriaDoEditor[];
}) {
  const [busca, setBusca] = useState('');
  const [soFora, setSoFora] = useState(false);

  const fora = produtos.filter((p) => !p.disponivel).length;

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const ordemCategoria = new Map(categorias.map((c) => [c.nome, c.ordem]));

    const filtrados = produtos.filter((p) => {
      if (soFora && p.disponivel) return false;
      if (termo && !p.nome.toLowerCase().includes(termo)) return false;
      return true;
    });

    const porCategoria = new Map<string, ProdutoDoEditor[]>();
    for (const p of filtrados) {
      const lista = porCategoria.get(p.categoriaNome) ?? [];
      lista.push(p);
      porCategoria.set(p.categoriaNome, lista);
    }

    return [...porCategoria.entries()]
      .sort(([a], [b]) => (ordemCategoria.get(a) ?? 999) - (ordemCategoria.get(b) ?? 999))
      .map(([nome, itens]) => ({
        nome,
        itens: itens.sort((a, b) => {
          // fora do ar primeiro: é o que alguém veio resolver
          if (a.disponivel !== b.disponivel) return a.disponivel ? 1 : -1;
          return a.nome.localeCompare(b.nome, 'pt-BR');
        }),
      }));
  }, [produtos, categorias, busca, soFora]);

  return (
    <div className="p-3 pb-10">
      <div className="mb-3 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar item"
            aria-label="Buscar item"
            className="h-12 w-full rounded-lg border-2 border-border bg-card pl-10 pr-3 text-[16px] outline-none focus-visible:border-brand"
          />
        </div>

        <button
          type="button"
          onClick={() => setSoFora((v) => !v)}
          aria-pressed={soFora}
          className={cn(
            'h-12 shrink-0 rounded-lg px-4 text-[14px] font-bold',
            soFora ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
          )}
        >
          Fora do ar
          {fora > 0 && <span className="tabular ml-1.5">{fora}</span>}
        </button>
      </div>

      {grupos.length === 0 ? (
        <p className="py-16 text-center text-base text-muted-foreground">
          {soFora ? 'Nada fora do ar. Cardápio inteiro no ar.' : `Nada com "${busca}".`}
        </p>
      ) : (
        <div className="space-y-4">
          {grupos.map((grupo) => (
            <section key={grupo.nome}>
              <h2 className="mb-1.5 px-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                {grupo.nome}
              </h2>
              <ul className="space-y-1.5">
                {grupo.itens.map((p) => (
                  <LinhaDeItem key={p.id} produto={p} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaDeItem({ produto }: { produto: ProdutoDoEditor }) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // O estado da tela anda na frente do servidor e volta se ele recusar.
  const [disponivel, verOtimista] = useOptimistic(
    produto.disponivel,
    (_atual: boolean, novo: boolean) => novo,
  );

  function alternar() {
    setErro(null);
    const alvo = !disponivel;

    iniciar(async () => {
      verOtimista(alvo);
      const r = await alternarDisponibilidade(produto.id, alvo);
      if (!r.ok) {
        // Não desfaço à mão: o `useOptimistic` volta sozinho ao valor do
        // servidor quando a transição termina sem o dado ter mudado.
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        'flex items-stretch gap-3 overflow-hidden rounded-lg border-2 bg-card',
        disponivel ? 'border-border' : 'border-alert-critical',
      )}
    >
      <div className="relative my-2 ml-2 size-14 shrink-0 overflow-hidden rounded-md bg-secondary">
        {produto.fotoUrl ? (
          <Image
            src={produto.fotoUrl}
            alt=""
            fill
            sizes="56px"
            className={cn('object-cover', !disponivel && 'grayscale')}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <CameraOffIcon className="size-5" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center py-2">
        <p className="truncate text-[16px] font-semibold leading-tight">{produto.nome}</p>
        <p className="tabular text-[13px] text-muted-foreground">
          {formatCents(produto.precoCents)}
        </p>
        {erro && <p className="mt-0.5 text-[12px] text-alert-critical">{erro}</p>}
      </div>

      <button
        type="button"
        onClick={alternar}
        aria-pressed={!disponivel}
        aria-label={
          disponivel ? `Marcar ${produto.nome} como esgotado` : `Voltar ${produto.nome} ao ar`
        }
        className={cn(
          'w-30 shrink-0 text-[15px] font-black uppercase tracking-wide',
          disponivel
            ? 'bg-secondary text-muted-foreground'
            : 'bg-alert-critical text-background',
        )}
      >
        {disponivel ? 'Zerou' : 'Voltar'}
      </button>
    </li>
  );
}
