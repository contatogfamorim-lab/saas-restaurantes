'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CameraOffIcon, ChevronRightIcon, PlusIcon, SearchIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import type { DelegatablePermission } from '@/lib/permissions';
import type { CategoriaDoEditor, ProdutoDoEditor } from '@/lib/cardapio/queries';

import { alternarDisponibilidade } from '@/app/app/(cardapio)/cardapio/actions';
import { NovoItem } from './novo-item';

type Filtro = 'todos' | 'fora' | 'sem-foto' | 'arquivados';

export function ListaDeItens({
  produtos,
  categorias,
  permissoes,
}: {
  produtos: ProdutoDoEditor[];
  categorias: CategoriaDoEditor[];
  permissoes: DelegatablePermission[];
}) {
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [criando, setCriando] = useState(false);

  const tem = (p: DelegatablePermission) => permissoes.includes(p);

  const foraDoAr = produtos.filter((p) => !p.arquivado && !p.disponivel).length;
  const semFoto = produtos.filter((p) => !p.arquivado && !p.fotoUrl).length;
  const arquivados = produtos.filter((p) => p.arquivado).length;

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return produtos.filter((p) => {
      if (filtro === 'arquivados' ? !p.arquivado : p.arquivado) return false;
      if (filtro === 'fora' && p.disponivel) return false;
      if (filtro === 'sem-foto' && p.fotoUrl) return false;
      if (termo && !p.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [produtos, busca, filtro]);

  /**
   * Agrupa por categoria e sobe o que está fora do ar.
   *
   * A ordem dentro do grupo é: fora do ar primeiro, depois sem foto, depois o
   * resto por nome. É a ordem de quem precisa de atenção.
   */
  const grupos = useMemo(() => {
    const porCategoria = new Map<string, ProdutoDoEditor[]>();

    for (const p of visiveis) {
      const lista = porCategoria.get(p.categoriaNome) ?? [];
      lista.push(p);
      porCategoria.set(p.categoriaNome, lista);
    }

    const ordemCategoria = new Map(categorias.map((c) => [c.nome, c.ordem]));

    return [...porCategoria.entries()]
      .sort(([a], [b]) => (ordemCategoria.get(a) ?? 999) - (ordemCategoria.get(b) ?? 999))
      .map(([nome, itens]) => ({
        nome,
        itens: itens.sort((a, b) => {
          if (a.disponivel !== b.disponivel) return a.disponivel ? 1 : -1;
          if (Boolean(a.fotoUrl) !== Boolean(b.fotoUrl)) return a.fotoUrl ? 1 : -1;
          return a.nome.localeCompare(b.nome, 'pt-BR');
        }),
      }));
  }, [visiveis, categorias]);

  const filtros: { chave: Filtro; rotulo: string; contagem?: number }[] = [
    { chave: 'todos', rotulo: 'Todos' },
    { chave: 'fora', rotulo: 'Fora do ar', contagem: foraDoAr },
    { chave: 'sem-foto', rotulo: 'Sem foto', contagem: semFoto },
    { chave: 'arquivados', rotulo: 'Arquivados', contagem: arquivados },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-45 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar item"
            aria-label="Buscar item"
            className="h-10 w-full rounded-md border border-border bg-card pl-8.5 pr-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[--brand]"
          />
        </div>

        {tem('menu.structure') && (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-[--brand] px-3 text-[13px] font-bold text-background"
          >
            <PlusIcon className="size-4" />
            Novo item
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {filtros.map((f) => (
          <button
            key={f.chave}
            type="button"
            onClick={() => setFiltro(f.chave)}
            aria-pressed={filtro === f.chave}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-[12px] font-semibold',
              filtro === f.chave
                ? 'bg-foreground text-background'
                : 'bg-secondary text-muted-foreground hover:text-foreground',
            )}
          >
            {f.rotulo}
            {f.contagem !== undefined && f.contagem > 0 && (
              <span className="tabular ml-1.5 opacity-70">{f.contagem}</span>
            )}
          </button>
        ))}
      </div>

      {grupos.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {busca ? `Nada encontrado para "${busca}".` : 'Nenhum item aqui.'}
        </p>
      ) : (
        <div className="space-y-4">
          {grupos.map((grupo) => (
            <section key={grupo.nome}>
              <h2 className="mb-1.5 px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {grupo.nome} · {grupo.itens.length}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {grupo.itens.map((p) => (
                  <ItemDaLista key={p.id} produto={p} podeAlternar={tem('menu.availability')} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {criando && (
        <NovoItem categorias={categorias} podePrecificar={tem('menu.price')} onFechar={() => setCriando(false)} />
      )}
    </div>
  );
}

function ItemDaLista({
  produto,
  podeAlternar,
}: {
  produto: ProdutoDoEditor;
  podeAlternar: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function alternar() {
    setErro(null);
    iniciar(async () => {
      const r = await alternarDisponibilidade(produto.id, !produto.disponivel);
      if (!r.ok) setErro(r.erro ?? 'Não deu certo');
      else router.refresh();
    });
  }

  return (
    <li className={cn('flex items-center gap-3 p-2.5', produto.arquivado && 'opacity-60')}>
      <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-secondary">
        {produto.fotoUrl ? (
          <Image
            src={produto.fotoUrl}
            alt=""
            fill
            sizes="48px"
            className={cn('object-cover', !produto.disponivel && 'grayscale')}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <CameraOffIcon className="size-4" />
          </div>
        )}
      </div>

      <Link href={`/app/cardapio/${produto.id}`} className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold leading-tight">{produto.nome}</p>
        <p className="tabular text-[12px] text-muted-foreground">
          {produto.precoCents > 0 ? formatCents(produto.precoCents) : 'sem preço'}
          {!produto.fotoUrl && ' · sem foto'}
          {produto.arquivado && ' · arquivado'}
        </p>
        {erro && <p className="mt-0.5 text-[11px] text-alert-critical">{erro}</p>}
      </Link>

      {!produto.arquivado && podeAlternar && (
        <button
          type="button"
          onClick={alternar}
          disabled={pendente}
          aria-pressed={produto.disponivel}
          className={cn(
            'h-9 shrink-0 rounded-md px-3 text-[12px] font-bold disabled:opacity-50',
            produto.disponivel
              ? 'bg-secondary text-muted-foreground'
              : 'bg-alert-critical text-background',
          )}
        >
          {produto.disponivel ? 'No ar' : 'Acabou'}
        </button>
      )}

      <Link
        href={`/app/cardapio/${produto.id}`}
        aria-label={`Editar ${produto.nome}`}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
      >
        <ChevronRightIcon className="size-4" />
      </Link>
    </li>
  );
}
