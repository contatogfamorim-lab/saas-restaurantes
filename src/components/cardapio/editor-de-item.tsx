'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArchiveIcon, ArchiveRestoreIcon, LockIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { RestricaoDoCardapio, SeloDoCardapio } from '@/lib/menu/types';
import { formatCentsBare, parseCents } from '@/lib/money';
import type { DelegatablePermission } from '@/lib/permissions';
import type {
  CategoriaDoEditor,
  MudancaDoItem,
  ProdutoDoEditor,
} from '@/lib/cardapio/queries';
import { arquivarProduto, salvarProduto } from '@/app/app/(cardapio)/cardapio/actions';
import { alternarDisponibilidade } from '@/app/app/(equipe)/disponibilidade/actions';

import { CampoDeFoto } from './campo-de-foto';
import { HistoricoDoItem } from './historico-do-item';
import { PreviewDoCelular } from './preview-do-celular';


/**
 * Edição de um item (spec §12).
 *
 * Os campos são CONTROLADOS, e não `defaultValue`, por um motivo só: o preview
 * ao lado precisa acompanhar a digitação. Um preview que só atualiza depois de
 * salvar não muda decisão nenhuma — a pessoa já decidiu quando apertou o botão.
 *
 * Cada campo pertence a uma permissão diferente, e o que a pessoa não pode
 * mexer aparece TRAVADO com o motivo, em vez de sumir. Sumir faria parecer que
 * o campo não existe; travado com o cadeado diz "existe, não é seu" — que é a
 * informação útil para quem vai pedir a permissão a alguém.
 *
 * Nada disso é proteção. O formulário inteiro pode ser reenviado na mão, e o
 * que recusa é o `products_column_guard` no banco (spec §10.3).
 */
export function EditorDeItem({
  produto,
  categorias,
  historico,
  permissoes,
  selos,
  restricoes,
}: {
  produto: ProdutoDoEditor;
  categorias: CategoriaDoEditor[];
  historico: MudancaDoItem[];
  permissoes: DelegatablePermission[];
  /** Selos da casa, com cor. Vêm do banco — ver o comentário no uso. */
  selos: SeloDoCardapio[];
  restricoes: RestricaoDoCardapio[];
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const tem = (p: DelegatablePermission) => permissoes.includes(p);
  const podeConteudo = tem('menu.content');
  const podePreco = tem('menu.price');
  const podeEstrutura = tem('menu.structure');
  const podeDisponibilidade = tem('menu.availability');

  // Rascunho local — é ele que o preview lê.
  const [nome, setNome] = useState(produto.nome);
  const [descricao, setDescricao] = useState(produto.descricao ?? '');
  const [preco, setPreco] = useState(formatCentsBare(produto.precoCents));
  const [prep, setPrep] = useState(String(produto.prepMinutos));
  const [categoriaId, setCategoriaId] = useState(produto.categoriaId);
  const [serve, setServe] = useState(String(produto.servePessoas));
  const [diet, setDiet] = useState<string[]>(produto.dietTags);
  const [badges, setBadges] = useState<string[]>(produto.badges);

  /** Foto escolhida e ainda não salva, para o preview não esperar o servidor. */
  const [fotoLocal, setFotoLocal] = useState<string | null>(null);

  const sujo =
    nome !== produto.nome ||
    descricao !== (produto.descricao ?? '') ||
    preco !== formatCentsBare(produto.precoCents) ||
    prep !== String(produto.prepMinutos) ||
    categoriaId !== produto.categoriaId ||
    serve !== String(produto.servePessoas) ||
    diet.join() !== produto.dietTags.join() ||
    badges.join() !== produto.badges.join();

  function enviar(formData: FormData) {
    setErro(null);
    setSalvo(false);
    iniciar(async () => {
      const r = await salvarProduto(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      setSalvo(true);
      router.refresh();
    });
  }

  function alternar() {
    setErro(null);
    iniciar(async () => {
      const r = await alternarDisponibilidade(produto.id, !produto.disponivel);
      if (!r.ok) setErro(r.erro ?? 'Não deu certo');
      else router.refresh();
    });
  }

  function arquivar() {
    setErro(null);
    iniciar(async () => {
      const r = await arquivarProduto(produto.id, !produto.arquivado);
      if (!r.ok) setErro(r.erro ?? 'Não deu certo');
      else router.refresh();
    });
  }

  function alternarNaLista(
    valor: string,
    lista: string[],
    setLista: (v: string[]) => void,
  ) {
    setLista(lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]);
  }

  return (
    <div className="grid gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_375px]">
      <div className="min-w-0 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <Link
            href="/app/cardapio"
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            ← Todos os itens
          </Link>
          {produto.arquivado && (
            <span className="rounded bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Arquivado
            </span>
          )}
        </div>

        <CampoDeFoto
          produtoId={produto.id}
          fotoUrl={produto.fotoUrl}
          nome={produto.nome}
          podeEditar={podeConteudo}
          onPreviewLocal={setFotoLocal}
        />

        {podeDisponibilidade && !produto.arquivado && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">
                {produto.disponivel ? 'No ar' : 'Marcado como esgotado'}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {produto.disponivel
                  ? 'O cliente está vendo e pode pedir.'
                  : 'Some do cardápio do cliente até você religar.'}
              </p>
            </div>
            <button
              type="button"
              onClick={alternar}
              disabled={pendente}
              aria-pressed={produto.disponivel}
              className={cn(
                'h-11 shrink-0 rounded-md px-4 text-[13px] font-bold disabled:opacity-50',
                produto.disponivel
                  ? 'bg-alert-critical text-background'
                  : 'bg-brand text-background',
              )}
            >
              {produto.disponivel ? 'Zerou' : 'Voltar ao ar'}
            </button>
          </div>
        )}

        <form action={enviar} className="space-y-3">
          <input type="hidden" name="id" value={produto.id} />

          <Campo rotulo="Nome" liberado={podeConteudo} permissao="menu.content">
            <input
              name="nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              maxLength={120}
              readOnly={!podeConteudo}
              className={entrada(podeConteudo)}
            />
          </Campo>

          <Campo
            rotulo="Descrição"
            liberado={podeConteudo}
            permissao="menu.content"
            dica={`O cliente lê no máximo duas linhas — o resto é cortado. ${descricao.length}/500`}
          >
            <textarea
              name="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={500}
              rows={3}
              readOnly={!podeConteudo}
              className={cn(entrada(podeConteudo), 'h-auto py-2 leading-snug')}
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Preço (R$)" liberado={podePreco} permissao="menu.price">
              <input
                name="preco"
                inputMode="decimal"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                readOnly={!podePreco}
                className={cn(entrada(podePreco), 'tabular')}
              />
            </Campo>

            <Campo
              rotulo="Preparo (min)"
              liberado={podeEstrutura}
              permissao="menu.structure"
              dica="Alimenta o cronômetro do KDS."
            >
              <input
                name="prepMinutos"
                type="number"
                min={0}
                max={240}
                value={prep}
                onChange={(e) => setPrep(e.target.value)}
                required
                readOnly={!podeEstrutura}
                className={cn(entrada(podeEstrutura), 'tabular')}
              />
            </Campo>

            <Campo rotulo="Serve" liberado={podeConteudo} permissao="menu.content">
              <input
                name="servePessoas"
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={serve}
                onChange={(e) => setServe(e.target.value)}
                readOnly={!podeConteudo}
                className={cn(entrada(podeConteudo), 'tabular')}
              />
            </Campo>
          </div>

          <Campo rotulo="Categoria" liberado={podeEstrutura} permissao="menu.structure">
            <select
              name="categoriaId"
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              disabled={!podeEstrutura}
              className={entrada(podeEstrutura)}
            >
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            {/* `disabled` não envia valor no FormData, e sem isto a categoria
                viraria vazia para quem não pode mexer. */}
            {!podeEstrutura && (
              <input type="hidden" name="categoriaId" value={categoriaId} />
            )}
          </Campo>

          <Selo
            rotulo="Selos"
            dica="Aparecem acima do nome, no card. Dois já é muito."
            liberado={podeConteudo}
            // DO BANCO, e não de uma lista escrita aqui. A versão anterior
            // tinha os quatro do enum fixos neste arquivo: selo criado na aba
            // "Selos" não aparecia, e não havia como pô-lo num prato. Era a
            // única tela que não sabia da 0043.
            opcoes={selos.map((b) => ({ valor: b.slug, rotulo: b.label, cor: b.color }))}
            ativos={badges}
            onAlternar={(v) => alternarNaLista(v, badges, setBadges)}
            campo="badges"
          />

          <Selo
            rotulo="Restrições"
            dica="O cliente filtra por elas. Errar aqui é sério: alguém com alergia acredita."
            liberado={podeConteudo}
            opcoes={restricoes.map((d) => ({
              valor: d.slug,
              rotulo: d.labelLong,
              cor: d.color,
            }))}
            ativos={diet}
            onAlternar={(v) => alternarNaLista(v, diet, setDiet)}
            campo="dietTags"
          />

          {/*
            A BARRA DE SALVAR É FIXA, e isso não é enfeite.

            O formulário tem dez campos e mede ~1400 px. O botão ficava no fim,
            390 px abaixo da dobra numa janela de 720 px, desabilitado a 40% de
            opacidade e escrito "Nada para salvar" — que foi como a pessoa o viu
            da última vez, antes de começar a editar. Você mexia no preço lá em
            cima e não havia nada na tela dizendo que existia algo para salvar,
            nem onde. Foi reportado como "falta um botão de salvar", que é
            exatamente o que a tela comunicava.

            Fixa embaixo, a barra responde à edição no mesmo instante: muda de
            rótulo, acende e passa a mostrar o erro ou o "Salvo" ao lado — tudo
            sem tirar os olhos do campo que está sendo mexido.
          */}
          <div className="sticky bottom-0 -mx-1 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
            {erro && (
              <p
                role="alert"
                className="mb-2 rounded-md bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical"
              >
                {erro}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={pendente || !sujo}
                className="h-11 flex-1 rounded-md bg-brand text-[14px] font-bold text-background disabled:opacity-40"
              >
                {pendente ? 'Salvando…' : sujo ? 'Salvar alterações' : 'Nada para salvar'}
              </button>

              {/* O estado ao LADO do botão, não acima: é para onde o olho já
                  está indo quando termina de editar. */}
              {sujo && !pendente && (
                <p className="shrink-0 text-[12px] text-alert-warning">
                  Alterações não salvas
                </p>
              )}
              {salvo && !erro && !sujo && (
                <p role="status" className="shrink-0 text-[12px] text-muted-foreground">
                  Salvo.
                </p>
              )}
            </div>
          </div>
        </form>

        {podeEstrutura && (
          <div className="rounded-lg border border-border p-3">
            <p className="text-[13px] font-semibold">
              {produto.arquivado ? 'Trazer de volta' : 'Tirar do cardápio'}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {produto.arquivado
                ? 'O item volta a aparecer na lista, ainda fora do ar.'
                : 'O item some do cardápio, mas continua nas comandas antigas. Não dá para apagar — o histórico depende dele.'}
            </p>
            <button
              type="button"
              onClick={arquivar}
              disabled={pendente}
              className="mt-2 flex h-10 items-center gap-2 rounded-md bg-secondary px-3 text-[13px] font-semibold disabled:opacity-50"
            >
              {produto.arquivado ? (
                <ArchiveRestoreIcon className="size-4" />
              ) : (
                <ArchiveIcon className="size-4" />
              )}
              {produto.arquivado ? 'Desarquivar' : 'Arquivar'}
            </button>
          </div>
        )}

        <HistoricoDoItem mudancas={historico} />
      </div>

      <div className="lg:pt-8">
        <PreviewDoCelular
          selos={selos}
          restricoes={restricoes}
          nome={nome}
          descricao={descricao.trim() || null}
          precoCents={parseCents(preco) ?? produto.precoCents}
          fotoUrl={fotoLocal ?? produto.fotoUrl}
          servePessoas={Number(serve) || 1}
          dietTags={diet}
          badges={badges}
          disponivel={produto.disponivel}
        />
      </div>
    </div>
  );
}

function entrada(liberado: boolean) {
  return cn(
    'mt-1 h-11 w-full rounded-md border px-3 text-[15px] outline-none',
    liberado
      ? 'border-border bg-card focus-visible:ring-2 focus-visible:ring-brand'
      : 'border-transparent bg-secondary text-muted-foreground',
  );
}

function Campo({
  rotulo,
  liberado,
  permissao,
  dica,
  children,
}: {
  rotulo: string;
  liberado: boolean;
  permissao: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        {rotulo}
        {!liberado && (
          <>
            <LockIcon className="size-3" />
            <span className="font-normal">precisa de {permissao}</span>
          </>
        )}
      </span>
      {children}
      {dica && liberado && (
        <span className="mt-1 block text-[11px] text-muted-foreground">{dica}</span>
      )}
    </label>
  );
}

/**
 * Grupo de marcadores.
 *
 * Os valores vão como campos ocultos repetidos, e não como JSON num input só:
 * `FormData.getAll` devolve a lista, e um array vazio simplesmente não manda
 * nada — que é o jeito de dizer "nenhum" sem inventar sentinela.
 */
function Selo({
  rotulo,
  dica,
  liberado,
  opcoes,
  ativos,
  onAlternar,
  campo,
}: {
  rotulo: string;
  dica: string;
  liberado: boolean;
  opcoes: { valor: string; rotulo: string; cor?: string }[];
  ativos: string[];
  onAlternar: (valor: string) => void;
  campo: string;
}) {
  return (
    <div>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        {rotulo}
        {!liberado && (
          <>
            <LockIcon className="size-3" />
            <span className="font-normal">precisa de menu.content</span>
          </>
        )}
      </span>

      <div className="mt-1 flex flex-wrap gap-1.5">
        {opcoes.map((o) => {
          const ativo = ativos.includes(o.valor);
          return (
            <button
              key={o.valor}
              type="button"
              disabled={!liberado}
              onClick={() => onAlternar(o.valor)}
              aria-pressed={ativo}
              // A COR do selo aparece já na escolha, e não só depois de salvar.
              // Escolher às cegas e descobrir no preview é uma viagem a mais
              // por decisão — e são quatro ou cinco decisões por prato.
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60',
                !o.cor && (ativo
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-transparent bg-secondary text-muted-foreground'),
              )}
              style={
                o.cor
                  ? ativo
                    ? { background: o.cor, borderColor: o.cor, color: '#fff' }
                    : {
                        color: o.cor,
                        borderColor: `color-mix(in oklab, ${o.cor} 40%, transparent)`,
                        background: `color-mix(in oklab, ${o.cor} 10%, transparent)`,
                      }
                  : undefined
              }
            >
              {o.rotulo}
            </button>
          );
        })}
      </div>

      {ativos.map((v) => (
        <input key={v} type="hidden" name={campo} value={v} />
      ))}

      <span className="mt-1 block text-[11px] text-muted-foreground">{dica}</span>
    </div>
  );
}
