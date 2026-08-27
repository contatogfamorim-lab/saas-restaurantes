'use client';

import { useRef, useState, useMemo } from 'react';
import { ReceiptTextIcon, WalletIcon } from 'lucide-react';

import { brandStyle } from '@/lib/brand';
import { addLine, setLineQty } from '@/lib/menu/cart';
import { useCart } from '@/lib/menu/use-cart';
import { useOrderStatus } from '@/lib/menu/use-order-status';
import type { MenuData, MenuProduct } from '@/lib/menu/types';

import { CartBar } from './cart-bar';
import { CategoryNav, useScrollSpy } from './category-nav';
import { FilterBar } from './filter-bar';
import { IdentifySheet } from './identify-sheet';
import { SeloDaPlataforma } from './selo-da-plataforma';
import { OrderTracker } from './order-tracker';
import { ProductCard } from './product-card';
import { ProductSheet } from './product-sheet';
import { PromoRail } from './promo-rail';
import { BannerDoCardapio } from './banner-do-cardapio';
import { urlDaImagem } from '@/lib/menu/imagens';

/**
 * Tela do cardápio do cliente.
 *
 * Mantém carrinho, filtros, busca e o envio do pedido. NÃO abre conexão
 * Realtime: o celular do cliente custaria caro demais no orçamento de 500
 * conexões do plano Pro (spec §9) — o status vem por polling de 10s.
 */
interface Props {
  menu: MenuData;
  shortCode: string;
}

export function MenuScreen({ menu, shortCode }: Props) {
  const [query, setQuery] = useState('');
  const [diets, setDiets] = useState<string[]>([]);
  const [onlyPromos, setOnlyPromos] = useState(false);
  const [selected, setSelected] = useState<MenuProduct | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(
    menu.categories[0]?.id ?? null,
  );

  // O carrinho sobrevive a fechar a aba sem querer — no meio do serviço isso
  // acontece o tempo todo, e remontar o pedido do zero é onde a pessoa desiste.
  const [lines, setLines] = useCart(`carrinho:${shortCode}`);
  const status = useOrderStatus();

  /**
   * Chave de idempotência da TENTATIVA de envio em curso (spec §13.7).
   *
   * Nasce no primeiro toque em "Enviar" e só é descartada quando o pedido
   * entra. Se a rede cair depois de o servidor gravar mas antes de a resposta
   * voltar, o retry manda a MESMA chave e recebe o mesmo pedido em vez de
   * criar outro.
   *
   * Não pode ser derivada do conteúdo do carrinho: "quero mais um igual" é
   * pedido normal numa mesa, e uma chave por conteúdo faria a segunda rodada
   * idêntica desaparecer silenciosamente.
   */
  const chaveEnvio = useRef<string | null>(null);

  // Nenhuma categoria com produto: restaurante novo, ou tudo fora da janela de
  // serviço. Nos dois casos não há o que filtrar.
  const semCardapio = menu.categories.every((c) => c.products.length === 0);

  const isFiltering = query.trim().length > 0 || diets.length > 0 || onlyPromos;
  const needle = query.trim().toLowerCase();

  const visibleCategories = menu.categories
    .map((category) => ({
      ...category,
      products: category.products.filter((product) => {
        if (onlyPromos && !product.promotion) return false;
        // filtros dietéticos combinam com E: quem marca vegano E sem glúten
        // tem as duas restrições, e devolver o que atende só uma seria grave
        if (!diets.every((tag) => product.dietTags.includes(tag))) return false;
        if (!needle) return true;
        // busca por nome E por ingrediente (spec §4) — a descrição é onde os
        // ingredientes moram
        return (
          product.name.toLowerCase().includes(needle) ||
          (product.description?.toLowerCase().includes(needle) ?? false)
        );
      }),
    }))
    .filter((category) => category.products.length > 0);

  const resultCount = visibleCategories.reduce((n, c) => n + c.products.length, 0);

  const banners = menu.blocos.filter((b) => b.tipo === 'banner');

  /**
   * A ordem das categorias, definida pelo editor de blocos.
   *
   * A REGRA QUE IMPEDE O PIOR ERRO: categoria sem bloco correspondente NÃO
   * some — vai para o fim. A alternativa (só aparece o que está no layout)
   * significa que cadastrar uma categoria e esquecer de arrastá-la ao editor
   * faz a comida desaparecer do cardápio, sem erro e sem aviso.
   *
   * O layout ORDENA e ACRESCENTA; nunca subtrai por omissão. Para esconder há
   * `is_hidden`, que é escolha explícita e já vem filtrada do banco.
   *
   * Sem layout publicado, `menu.blocos` é vazio e isto devolve exatamente o que
   * o cardápio sempre devolveu.
   */
  const categoriasOrdenadas = useMemo(() => {
    const noLayout = menu.blocos
      .filter((b) => b.tipo === 'category' && b.config.category_id)
      .map((b) => b.config.category_id!);

    if (noLayout.length === 0) return visibleCategories;

    const posicao = new Map(noLayout.map((id, i) => [id, i]));
    return [...visibleCategories].sort((a, b) => {
      // `?? Infinity` é o que manda para o fim quem não está no layout.
      const pa = posicao.get(a.id) ?? Number.POSITIVE_INFINITY;
      const pb = posicao.get(b.id) ?? Number.POSITIVE_INFINITY;
      return pa - pb;
    });
  }, [menu.blocos, visibleCategories]);

  useScrollSpy(
    menu.categories.map((c) => c.id),
    setActiveCategory,
    !isFiltering,
  );

  function openProduct(product: MenuProduct) {
    setSelected(product);
    setSheetOpen(true);
  }

  function qtyInCart(productId: string) {
    return lines
      .filter((l) => l.productId === productId)
      .reduce((sum, l) => sum + l.qty, 0);
  }

  /**
   * Envia a rodada.
   *
   * O corpo carrega SÓ o que foi escolhido — nenhum valor em centavos. O
   * servidor recalcula tudo a partir do banco (spec §10.1).
   */
  async function enviarPedido() {
    chaveEnvio.current ??= crypto.randomUUID();

    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: chaveEnvio.current,
        items: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          modifierOptionIds: l.modifiers.map((m) => m.optionId),
          notes: l.notes || undefined,
          guestId: l.eaterGuestId,
        })),
      }),
    });

    if (res.ok) {
      // pedido entrou: a chave cumpriu o papel e a próxima rodada usa outra
      chaveEnvio.current = null;
      setLines([]);
      setCartOpen(false);
      setErro(null);
      await status.recarregar();
      setTrackerOpen(true);
      return true;
    }

    const corpo = await res.json().catch(() => ({}));
    setErro(corpo.message ?? 'Não conseguimos enviar. Tente de novo.');
    return false;
  }

  async function handleEnviar() {
    if (enviando || lines.length === 0) return;

    // Sem comanda ainda: pede o nome primeiro (spec §4). Com comanda, a pessoa
    // já se identificou nesta mesa e não é perguntada de novo.
    if (!status.ativo) {
      setErro(null);
      setIdentifyOpen(true);
      return;
    }

    setEnviando(true);
    await enviarPedido();
    setEnviando(false);
  }

  async function handleIdentificar(dados: {
    nome: string;
    telefone?: string;
    consentimento: boolean;
  }) {
    setEnviando(true);
    setErro(null);

    const res = await fetch(`/api/mesa/${shortCode}/entrar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: dados.nome,
        telefone: dados.telefone,
        consentimentoLgpd: dados.consentimento,
      }),
    });

    if (!res.ok) {
      const corpo = await res.json().catch(() => ({}));
      setErro(corpo.message ?? 'Não conseguimos abrir sua comanda.');
      setEnviando(false);
      return;
    }

    const ok = await enviarPedido();
    if (ok) setIdentifyOpen(false);
    setEnviando(false);
  }

  const temPedidoEmAndamento = status.ativo && status.itens.length > 0;

  return (
    <div className="mx-auto min-h-dvh max-w-lg" style={brandStyle(menu.restaurant.brandColor)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-5">
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted-foreground">
            {menu.table.label} · {menu.table.area}
          </p>
          <h1 className="font-display mt-0.5 text-[26px] leading-tight">
            {menu.restaurant.name}
          </h1>
        </div>

        <div className="mt-1 flex shrink-0 items-center gap-2">
          {temPedidoEmAndamento && (
            <button
              type="button"
              onClick={() => setTrackerOpen(true)}
              className="flex items-center gap-1.5 rounded-full border border-input px-3 py-1.5 text-[12px] font-medium active:bg-accent"
            >
              <ReceiptTextIcon className="size-3.5" />
              Meu pedido
            </button>
          )}

          {/* A porta da conta. Aparece SEMPRE que a casa dá cashback, mesmo para
              quem não tem conta — é lá dentro que a oferta é explicada. Escondê-la
              de quem ainda não se cadastrou seria escondê-la de todo mundo que
              importa. */}
          <a
            href={`/m/${shortCode}/conta`}
            className="flex items-center gap-1.5 rounded-full border border-input px-3 py-1.5 text-[12px] font-medium active:bg-accent"
          >
            <WalletIcon className="size-3.5" />
            Minha conta
          </a>
        </div>
      </header>

      {status.encerrada && (
        <p
          role="status"
          className="mx-4 mt-4 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground"
        >
          Esta mesa foi encerrada. Um novo pedido abre uma comanda nova.
        </p>
      )}

      {/* Restaurante recém-criado ainda não tem produto, e a tela sem esta
          mensagem mostrava busca e filtros sobre o nada — a primeira coisa que
          o dono vê ao escanear o próprio QR para testar. Dizer o que está
          acontecendo custa uma frase. */}
      {semCardapio ? (
        <main className="px-6 py-16 text-center">
          <p className="font-display text-xl leading-tight">
            Cardápio a caminho
          </p>
          <p className="mx-auto mt-2 max-w-70 text-[14px] leading-relaxed text-muted-foreground">
            Este restaurante ainda está montando o cardápio. Chame quem está
            atendendo — o pedido pode ser feito na mesa do mesmo jeito.
          </p>
        </main>
      ) : (
      <>
      {/* BANNERS antes de qualquer coisa, e só quando não há filtro: quem está
          buscando "sem glúten" não quer uma foto de hambúrguer no caminho. */}
      {!isFiltering &&
        banners.map((b) => (
          <div key={b.id} className="pb-1 pt-1">
            <BannerDoCardapio
              imagens={(b.config.imagens ?? []).map((i) => ({
                url: urlDaImagem(i.caminho),
                alt: i.alt,
              }))}
              intervaloMs={b.config.intervalo_ms}
            />
          </div>
        ))}

      {!isFiltering && <PromoRail products={menu.promoted} onOpen={openProduct} />}

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        activeDiets={diets}
        onToggleDiet={(tag) =>
          setDiets((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
          )
        }
        onlyPromos={onlyPromos}
        onToggleOnlyPromos={() => setOnlyPromos((v) => !v)}
        hasPromos={menu.promoted.length > 0}
        restricoes={menu.restaurant.restricoes}
      />

      {!isFiltering && (
        <CategoryNav
          categories={menu.categories}
          activeId={activeCategory}
          onActiveChange={setActiveCategory}
        />
      )}

      {isFiltering && (
        <p aria-live="polite" className="px-4 pb-1 pt-2 text-[13px] text-muted-foreground">
          {resultCount === 0
            ? 'Nenhum item encontrado'
            : `${resultCount} ${resultCount === 1 ? 'item' : 'itens'}`}
        </p>
      )}

      <main>
        {categoriasOrdenadas.map((category, categoryIndex) => (
          <section
            key={category.id}
            id={`categoria-${category.id}`}
            aria-labelledby={`titulo-${category.id}`}
            className="scroll-mt-16 pt-5"
          >
            <h2
              id={`titulo-${category.id}`}
              className="font-display px-4 text-[15px] uppercase tracking-wide text-muted-foreground"
            >
              {category.name}
            </h2>

            <div className="mt-1 divide-y">
              {category.products.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onOpen={openProduct}
                  // só as duas primeiras da primeira seção entram como
                  // prioritárias; o resto é lazy (spec §13.2)
                  priority={categoryIndex === 0 && index < 2}
                  selos={menu.restaurant.selos}
                  restricoes={menu.restaurant.restricoes}
                  inCart={qtyInCart(product.id)}
                />
              ))}
            </div>
          </section>
        ))}

        {resultCount === 0 && isFiltering && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">Nada com esses filtros agora.</p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setDiets([]);
                setOnlyPromos(false);
              }}
              className="mt-3 text-sm font-medium text-primary underline underline-offset-4"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </main>
      </>
      )}

      <SeloDaPlataforma />

      <ProductSheet
        restricoes={menu.restaurant.restricoes}
        product={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onAdd={(line) => setLines((prev) => addLine(prev, line))}
      />

      <CartBar
        lines={lines}
        open={cartOpen}
        onOpenChange={setCartOpen}
        onChangeQty={(lineId, qty) => setLines((prev) => setLineQty(prev, lineId, qty))}
        onChangeEater={(lineId, guestId) =>
          setLines((prev) =>
            prev.map((l) => (l.lineId === lineId ? { ...l, eaterGuestId: guestId } : l)),
          )
        }
        onClear={() => setLines([])}
        onEnviar={handleEnviar}
        enviando={enviando}
        erro={erro}
        convidados={status.convidados}
      />

      <IdentifySheet
        open={identifyOpen}
        onOpenChange={setIdentifyOpen}
        restaurantName={menu.restaurant.name}
        cashbackPct={menu.restaurant.cashbackPct}
        shortCode={shortCode}
        requirePhone={menu.restaurant.requirePhone}
        enviando={enviando}
        erro={erro}
        onConfirm={handleIdentificar}
      />

      <OrderTracker
        open={trackerOpen}
        onOpenChange={setTrackerOpen}
        itens={status.itens}
        totais={status.totais}
        offline={status.offline}
        temMaisDeUmaPessoa={status.convidados.length > 1}
      />
    </div>
  );
}

