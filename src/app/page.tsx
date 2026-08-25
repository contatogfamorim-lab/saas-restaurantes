import type { Metadata } from 'next';
import Link from 'next/link';

import { createAdminClient } from '@/lib/supabase/admin';

export const metadata: Metadata = {
  title: 'Markello — pedidos por mesa',
  description:
    'Demonstração de um sistema multi-tenant de pedidos por mesa: cardápio do cliente, ' +
    'salão, cozinha, caixa e console de gestão.',
};

/** A demonstração precisa do estado atual do banco; cache aqui mostraria mesa errada. */
export const dynamic = 'force-dynamic';

/**
 * Porta de entrada da demonstração.
 *
 * A raiz era o "Hello world!" do scaffold — a primeira coisa que qualquer
 * pessoa vê ao abrir o endereço, e a única página que muita gente vai abrir.
 *
 * Seis superfícies e nenhuma delas é descobrível sozinha: o cardápio precisa do
 * `short_code` de uma mesa, e as telas da equipe precisam de login. Sem esta
 * página, o link do portfólio leva a lugar nenhum.
 */
export default async function Home() {
  // O short_code é aleatório e muda a cada `db:reset`. Fixar um aqui deixaria o
  // link quebrado no primeiro reset — busca a mesa de verdade.
  const admin = createAdminClient();
  const { data: mesa } = await admin
    .from('restaurant_tables')
    .select('short_code, label, restaurants(name)')
    .eq('active', true)
    .order('label')
    .limit(1)
    .maybeSingle();

  const restaurante =
    (mesa?.restaurants as unknown as { name: string } | null)?.name ?? 'restaurante';

  return (
    <main className="mx-auto max-w-3xl px-6 py-14 sm:py-20">
      <header>
        <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Demonstração
        </p>
        <h1 className="font-display mt-1 text-4xl leading-[1.05] sm:text-5xl">
          Pedidos por mesa,
          <br />
          do QR ao fechamento da conta.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          O cliente encosta o celular na etiqueta da mesa e o cardápio abre sem
          instalar nada. O pedido <strong className="text-foreground">não vai
          direto para a cozinha</strong> — passa pelo garçom, e só depois entra
          em produção. Multi-tenant desde a primeira linha.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          Comece por aqui
        </h2>

        {mesa ? (
          <Link
            href={`/m/${mesa.short_code}`}
            className="mt-2 block rounded-xl border-2 border-brand bg-card p-5 transition-colors hover:bg-secondary/40"
          >
            <p className="font-display text-2xl leading-tight">O cardápio do cliente</p>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {mesa.label} do {restaurante}. É o que abre ao apontar a câmera
              para o QR da mesa — sem login, sem instalar nada.
            </p>
            <p className="mt-2 text-[13px] font-semibold text-brand">
              Abrir o cardápio →
            </p>
          </Link>
        ) : (
          <p className="mt-2 rounded-xl border border-border bg-card p-5 text-[14px] text-muted-foreground">
            Nenhuma mesa cadastrada nesta instância ainda.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          As telas da equipe
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Cada função tem a sua porta e enxerga só o que é dela: o garçom aprova
          pedido e leva prato, a cozinha produz e diz o que acabou, o caixa
          fecha conta, e só o administrador vê faturamento. A diferença entre
          elas é o produto.
        </p>

        {/*
          Nenhuma credencial publicada aqui, e nem precisa: quem quiser percorrer
          as telas cria a PRÓPRIA conta e um restaurante próprio. Login
          compartilhado numa página aberta seria uma conta real, com senha real,
          num sistema real — exposta a quem passar.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href="/comecar"
            className="flex h-11 items-center rounded-lg bg-brand px-5 text-[14px] font-bold text-background"
          >
            Criar meu restaurante
          </Link>
          <Link
            href="/app/entrar"
            className="flex h-11 items-center rounded-lg border border-border px-5 text-[14px] font-semibold"
          >
            Já tenho conta
          </Link>
        </div>
        <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
          O cadastro pergunta como é a casa e monta o sistema a partir das
          respostas. Dá para pedir um restaurante <strong>já em movimento</strong>
          {' '}— mesa ocupada, pedido esperando o garçom, prato na passagem — que
          se apaga sozinho em 3 horas, junto com a conta.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          O que foi construído por baixo
        </h2>

        <dl className="mt-2 space-y-3 text-[14px] leading-relaxed">
          {[
            [
              'O servidor nunca confia no cliente',
              'O celular manda só produto, quantidade e observação. Preço, total e desconto são resolvidos no banco. Injetar preço 1 no corpo do pedido registra o preço do catálogo.',
            ],
            [
              'RLS em todas as tabelas, verificada nas duas direções',
              'Um script confere que o anônimo lê exatamente as cinco tabelas do cardápio — nem mais, nem menos. A versão que só checava "não escreve" passava por vacuidade.',
            ],
            [
              'Toda decisão de dinheiro deixa rastro',
              'Preço, desconto, taxa de serviço e liberação forçada de mesa vão para uma tabela imutável — que ninguém atualiza nem apaga, nem o administrador.',
            ],
            [
              'Cada guarda foi vista falhando',
              'Guarda que nunca falhou é uma linha verde. Todas foram testadas contra sabotagem deliberada, e três delas já passavam por vacuidade antes de serem consertadas.',
            ],
          ].map(([titulo, texto]) => (
            <div key={titulo}>
              <dt className="font-semibold">{titulo}</dt>
              <dd className="text-muted-foreground">{texto}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------------------------------------------------------- */}
      <footer className="mt-12 border-t border-border pt-5">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">É uma demonstração.</strong> Os
          dados são fictícios: nada aqui contém informação real de pessoa ou de
          estabelecimento.
        </p>
      </footer>
    </main>
  );
}
