'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArchiveIcon, ArchiveRestoreIcon, LockIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCentsBare } from '@/lib/money';
import type { DelegatablePermission } from '@/lib/permissions';
import type {
  CategoriaDoEditor,
  MudancaDoItem,
  ProdutoDoEditor,
} from '@/lib/cardapio/queries';
import {
  alternarDisponibilidade,
  arquivarProduto,
  salvarProduto,
} from '@/app/app/(cardapio)/cardapio/actions';

import { CampoDeFoto } from './campo-de-foto';
import { HistoricoDoItem } from './historico-do-item';

/**
 * Edição de um item (spec §12).
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
}: {
  produto: ProdutoDoEditor;
  categorias: CategoriaDoEditor[];
  historico: MudancaDoItem[];
  permissoes: DelegatablePermission[];
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

  // Quem não pode mexer em NENHUM campo do formulário não vê formulário. Era o
  // caso da cozinha: seis campos com cadeado e um botão "Salvar" que não
  // salvaria nada — uma tela que só serve para a pessoa descobrir que não pode.
  // O que ela pode fazer, ligar e desligar o item, ganhou lugar próprio acima.
  const podeAlgumCampo = podeConteudo || podePreco || podeEstrutura;

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

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href="/app/cardapio"
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          ← Cardápio
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
                : 'bg-[--brand] text-background',
            )}
          >
            {produto.disponivel ? 'Acabou' : 'Voltar ao ar'}
          </button>
        </div>
      )}

      {!podeAlgumCampo ? (
        <p className="rounded-lg bg-secondary px-3 py-2.5 text-[12px] text-muted-foreground">
          Você não tem permissão para editar os dados deste item. Nome, preço e
          foto são de quem tem <strong>menu.content</strong>,{' '}
          <strong>menu.price</strong> e <strong>menu.structure</strong>.
        </p>
      ) : (
      <form action={enviar} className="space-y-3">
        <input type="hidden" name="id" value={produto.id} />

        <Campo
          rotulo="Nome"
          liberado={podeConteudo}
          permissao="menu.content"
        >
          <input
            name="nome"
            defaultValue={produto.nome}
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
          dica="O que o cliente lê antes de decidir. Prometa o que o prato entrega."
        >
          <textarea
            name="descricao"
            defaultValue={produto.descricao ?? ''}
            maxLength={500}
            rows={3}
            readOnly={!podeConteudo}
            className={cn(entrada(podeConteudo), 'h-auto py-2 leading-snug')}
          />
        </Campo>

        <Campo rotulo="Preço (R$)" liberado={podePreco} permissao="menu.price">
          <input
            name="preco"
            inputMode="decimal"
            defaultValue={formatCentsBare(produto.precoCents)}
            readOnly={!podePreco}
            className={cn(entrada(podePreco), 'tabular')}
          />
        </Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Categoria" liberado={podeEstrutura} permissao="menu.structure">
            <select
              name="categoriaId"
              defaultValue={produto.categoriaId}
              disabled={!podeEstrutura}
              className={entrada(podeEstrutura)}
            >
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            {/* `disabled` não envia valor no FormData, e sem isto trocar de
                categoria viraria "categoria vazia" para quem não pode mexer. */}
            {!podeEstrutura && (
              <input type="hidden" name="categoriaId" value={produto.categoriaId} />
            )}
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
              defaultValue={produto.prepMinutos}
              required
              readOnly={!podeEstrutura}
              className={cn(entrada(podeEstrutura), 'tabular')}
            />
          </Campo>
        </div>

        {erro && (
          <p role="alert" className="rounded-md bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical">
            {erro}
          </p>
        )}
        {salvo && !erro && (
          <p role="status" className="text-[13px] text-muted-foreground">
            Salvo.
          </p>
        )}

        <button
          type="submit"
          disabled={pendente}
          className="h-11 w-full rounded-md bg-[--brand] text-[14px] font-bold text-background disabled:opacity-50"
        >
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
      )}

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
  );
}

function entrada(liberado: boolean) {
  return cn(
    'mt-1 h-11 w-full rounded-md border px-3 text-[15px] outline-none',
    liberado
      ? 'border-border bg-card focus-visible:ring-2 focus-visible:ring-[--brand]'
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
