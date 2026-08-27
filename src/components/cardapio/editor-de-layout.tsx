'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  LayoutListIcon,
  SparklesIcon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { comprimirFoto } from '@/lib/cardapio/comprimir-foto';
import { urlDaImagem } from '@/lib/menu/imagens';
import {
  adicionarBloco,
  atualizarBloco,
  moverBloco,
  publicarLayout,
  removerBloco,
} from '@/app/app/(cardapio)/cardapio/layout-do-cardapio/actions';

interface Bloco {
  id: string;
  tipo: string;
  oculto: boolean;
  config: Record<string, unknown>;
}

interface Categoria {
  id: string;
  nome: string;
}

const ICONES: Record<string, typeof ImageIcon> = {
  banner: ImageIcon,
  featured_group: SparklesIcon,
  category: LayoutListIcon,
  text: TypeIcon,
};

const NOMES: Record<string, string> = {
  banner: 'Banner',
  featured_group: 'Destaques',
  category: 'Categoria',
  text: 'Texto',
};

/**
 * Organizar o cardápio (§12.10).
 *
 * A ordem daqui é a ordem que o cliente vê. Duas coisas que a tela precisa
 * deixar óbvias, e que estão escritas nela:
 *
 * 1. nada é publicado até apertar "Publicar" — mexer aqui não muda o celular de
 *    quem está pedindo agora;
 * 2. categoria que NÃO está na lista continua aparecendo, no fim. Esconder
 *    comida por esquecimento seria o pior defeito possível num sistema de
 *    pedidos, e a tela diz isso em vez de deixar a pessoa descobrir.
 */
export function EditorDeLayout({
  erro: erroInicial,
  podePublicar,
  temPublicado,
  blocos,
  categorias,
}: {
  erro: string | null;
  podePublicar: boolean;
  temPublicado: boolean;
  blocos: Bloco[];
  categorias: Categoria[];
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(erroInicial);

  function acao(fn: () => Promise<{ ok: boolean; erro?: string }>) {
    setErro(null);
    iniciar(async () => {
      const r = await fn();
      if (!r.ok) setErro(r.erro ?? 'Não deu certo');
      else router.refresh();
    });
  }

  const categoriasNoLayout = new Set(
    blocos.filter((b) => b.tipo === 'category').map((b) => b.config.category_id as string),
  );
  const foraDoLayout = categorias.filter((c) => !categoriasNoLayout.has(c.id));

  return (
    <main className="mx-auto max-w-2xl px-5 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl leading-tight">Organizar cardápio</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            A ordem aqui é a ordem que o cliente vê.
          </p>
        </div>

        {podePublicar && (
          <button
            type="button"
            onClick={() => acao(publicarLayout)}
            disabled={pendente}
            className="h-10 shrink-0 rounded-md bg-brand px-4 text-[13px] font-bold text-background disabled:opacity-50"
          >
            {pendente ? 'Publicando…' : 'Publicar'}
          </button>
        )}
      </div>

      <p className="mt-4 rounded-lg bg-secondary/60 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
        {temPublicado
          ? 'Você está mexendo num rascunho. O cliente continua vendo a versão publicada até você apertar Publicar.'
          : 'Ainda não há nada publicado. Monte a ordem e aperte Publicar quando estiver pronto.'}
      </p>

      {erro && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical"
        >
          {erro}
        </p>
      )}

      {/* ---- o que dá para acrescentar ---- */}
      <div className="mt-5 flex flex-wrap gap-2">
        <Adicionar
          rotulo="Banner"
          icone={ImageIcon}
          onClick={() => acao(() => adicionarBloco('banner', { imagens: [], intervalo_ms: 5000 }))}
          pendente={pendente}
        />
        <Adicionar
          rotulo="Destaques"
          icone={SparklesIcon}
          onClick={() =>
            acao(() =>
              adicionarBloco('featured_group', {
                titulo: 'Promoções de hoje',
                origem: 'promocoes',
              }),
            )
          }
          pendente={pendente}
        />
        <Adicionar
          rotulo="Texto"
          icone={TypeIcon}
          onClick={() => acao(() => adicionarBloco('text', { titulo: '', corpo: '' }))}
          pendente={pendente}
        />
      </div>

      <ul className="mt-4 space-y-2">
        {blocos.length === 0 && (
          <li className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
            Nada organizado ainda. As categorias aparecem na ordem que estão em
            “Categorias”.
          </li>
        )}

        {blocos.map((b, i) => (
          <LinhaDeBloco
            key={b.id}
            bloco={b}
            categorias={categorias}
            primeiro={i === 0}
            ultimo={i === blocos.length - 1}
            pendente={pendente}
            onAcao={acao}
          />
        ))}
      </ul>

      {/* ---- as categorias que não estão no layout ---- */}
      {foraDoLayout.length > 0 && (
        <div className="mt-6 rounded-xl border border-border p-4">
          <p className="text-[13px] font-semibold">Aparecem depois, nesta ordem</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Categoria que não está na lista acima <strong>não some</strong> — ela
            vai para o fim do cardápio. Acrescente aqui só se quiser mudar a
            posição dela.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {foraDoLayout.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => acao(() => adicionarBloco('category', { category_id: c.id }))}
                disabled={pendente}
                className="h-9 rounded-md bg-secondary px-3 text-[13px] font-semibold disabled:opacity-50"
              >
                + {c.nome}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function Adicionar({
  rotulo,
  icone: Icone,
  onClick,
  pendente,
}: {
  rotulo: string;
  icone: typeof ImageIcon;
  onClick: () => void;
  pendente: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pendente}
      className="flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-semibold disabled:opacity-50"
    >
      <Icone className="size-4" />
      {rotulo}
    </button>
  );
}

function LinhaDeBloco({
  bloco,
  categorias,
  primeiro,
  ultimo,
  pendente,
  onAcao,
}: {
  bloco: Bloco;
  categorias: Categoria[];
  primeiro: boolean;
  ultimo: boolean;
  pendente: boolean;
  onAcao: (fn: () => Promise<{ ok: boolean; erro?: string }>) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const Icone = ICONES[bloco.tipo] ?? LayoutListIcon;

  const nome =
    bloco.tipo === 'category'
      ? (categorias.find((c) => c.id === bloco.config.category_id)?.nome ?? 'Categoria')
      : ((bloco.config.titulo as string) || NOMES[bloco.tipo] || bloco.tipo);

  return (
    <li className={cn('rounded-lg border border-border bg-card', bloco.oculto && 'opacity-50')}>
      <div className="flex items-center gap-2 p-3">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label="Subir"
            disabled={primeiro || pendente}
            onClick={() => onAcao(() => moverBloco(bloco.id, 'cima'))}
            className="text-muted-foreground disabled:opacity-25"
          >
            <ChevronUpIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Descer"
            disabled={ultimo || pendente}
            onClick={() => onAcao(() => moverBloco(bloco.id, 'baixo'))}
            className="text-muted-foreground disabled:opacity-25"
          >
            <ChevronDownIcon className="size-4" />
          </button>
        </div>

        <Icone className="size-4 shrink-0 text-muted-foreground" />

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-[14px] font-semibold">{nome}</span>
          <span className="block text-[11px] text-muted-foreground">
            {NOMES[bloco.tipo] ?? bloco.tipo}
            {bloco.tipo === 'banner' &&
              ` · ${((bloco.config.imagens as unknown[]) ?? []).length} imagem(ns)`}
          </span>
        </button>

        <button
          type="button"
          aria-label={bloco.oculto ? 'Mostrar' : 'Esconder'}
          disabled={pendente}
          onClick={() => onAcao(() => atualizarBloco(bloco.id, undefined, !bloco.oculto))}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-50"
        >
          {bloco.oculto ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>

        <button
          type="button"
          aria-label="Remover"
          disabled={pendente}
          onClick={() => onAcao(() => removerBloco(bloco.id))}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-50"
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>

      {aberto && bloco.tipo === 'banner' && <ImagensDoBanner bloco={bloco} onAcao={onAcao} />}
      {aberto && bloco.tipo === 'featured_group' && (
        <CampoTitulo bloco={bloco} onAcao={onAcao} rotulo="Título da seção" />
      )}
      {aberto && bloco.tipo === 'text' && (
        <CampoTitulo bloco={bloco} onAcao={onAcao} rotulo="Título" comCorpo />
      )}
    </li>
  );
}

function CampoTitulo({
  bloco,
  onAcao,
  rotulo,
  comCorpo = false,
}: {
  bloco: Bloco;
  onAcao: (fn: () => Promise<{ ok: boolean; erro?: string }>) => void;
  rotulo: string;
  comCorpo?: boolean;
}) {
  const [titulo, setTitulo] = useState((bloco.config.titulo as string) ?? '');
  const [corpo, setCorpo] = useState((bloco.config.corpo as string) ?? '');

  return (
    <div className="border-t border-border p-3">
      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">{rotulo}</span>
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={() =>
            onAcao(() => atualizarBloco(bloco.id, { ...bloco.config, titulo, corpo }))
          }
          maxLength={60}
          className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
      </label>

      {comCorpo && (
        <label className="mt-3 block">
          <span className="text-[12px] font-semibold text-muted-foreground">Texto</span>
          <textarea
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            onBlur={() =>
              onAcao(() => atualizarBloco(bloco.id, { ...bloco.config, titulo, corpo }))
            }
            rows={3}
            maxLength={280}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </label>
      )}
    </div>
  );
}

/**
 * As imagens do banner.
 *
 * Sobem DIRETO do navegador para o Storage, já comprimidas — o mesmo caminho da
 * foto de produto (§13.2). O arquivo original não chega ao servidor, e o que o
 * cliente recebe é a versão de até 50 KB.
 */
function ImagensDoBanner({
  bloco,
  onAcao,
}: {
  bloco: Bloco;
  onAcao: (fn: () => Promise<{ ok: boolean; erro?: string }>) => void;
}) {
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const imagens = ((bloco.config.imagens as { caminho: string; alt?: string }[]) ?? []);

  async function escolher(arquivo: File) {
    setErro(null);
    setSubindo(true);
    try {
      const pronta = await comprimirFoto(arquivo);
      const supabase = createClient();

      const { data: sessao } = await supabase.auth.getUser();
      if (!sessao.user) throw new Error('Sessão expirada. Entre de novo.');

      const { data: perfil } = await supabase
        .from('profiles')
        .select('restaurant_id')
        .eq('id', sessao.user.id)
        .single();

      const caminho = `${perfil!.restaurant_id}/banner-${pronta.arquivo.name}`;
      const { error } = await supabase.storage
        .from('product-photos')
        .upload(caminho, pronta.arquivo, {
          contentType: 'image/webp',
          cacheControl: '31536000',
        });

      if (error) throw new Error(error.message);

      onAcao(() =>
        atualizarBloco(bloco.id, {
          ...bloco.config,
          imagens: [...imagens, { caminho }],
        }),
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não deu certo');
    } finally {
      setSubindo(false);
    }
  }

  return (
    <div className="border-t border-border p-3">
      <div className="flex flex-wrap gap-2">
        {imagens.map((img) => (
          <div key={img.caminho} className="relative size-20 overflow-hidden rounded-md bg-secondary">
            <Image
              src={urlDaImagem(img.caminho)}
              alt=""
              fill
              sizes="80px"
              className="object-cover"
            />
            <button
              type="button"
              aria-label="Tirar esta imagem"
              onClick={() =>
                onAcao(() =>
                  atualizarBloco(bloco.id, {
                    ...bloco.config,
                    imagens: imagens.filter((i) => i.caminho !== img.caminho),
                  }),
                )
              }
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded bg-background/80 text-[11px]"
            >
              ×
            </button>
          </div>
        ))}

        <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void escolher(f);
              e.target.value = '';
            }}
          />
          {subindo ? '…' : '+ Imagem'}
        </label>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Passam sozinhas a cada 5 segundos, e param quando o cliente toca.
        Comprimidas aqui no aparelho, como as fotos dos pratos.
      </p>

      {erro && <p className="mt-2 text-[12px] text-alert-critical">{erro}</p>}
    </div>
  );
}
