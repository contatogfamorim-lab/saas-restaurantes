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
        <p className="mt-1 text-[13px] text-muted-foreground">
          Cada função tem a sua porta e enxerga só o que é dela. Entre com
          qualquer um destes e compare — a diferença entre eles é o produto.
        </p>

        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {[
            {
              papel: 'Administrador',
              usuario: 'dono@brasaburger.test',
              ve: 'Tudo: console de gestão, editor de cardápio, auditoria, mesas e QR',
            },
            {
              papel: 'Garçom',
              usuario: 'garcom@brasaburger.test',
              ve: 'Salão, passagem e a fila de aprovação. Não entra na gestão',
            },
            {
              papel: 'Cozinha',
              usuario: 'cozinha@brasaburger.test',
              ve: 'KDS e "acabou". Não vê preço, não vê faturamento',
            },
            {
              papel: 'Caixa',
              usuario: 'caixa@brasaburger.test',
              ve: 'Comandas, divisão e pagamento. Desconto até 10%',
            },
          ].map((p) => (
            <li key={p.usuario} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[15px] font-semibold">{p.papel}</span>
                <code className="tabular text-[12px] text-muted-foreground">
                  {p.usuario}
                </code>
              </div>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {p.ve}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            href="/app/entrar"
            className="flex h-11 items-center rounded-lg bg-brand px-5 text-[14px] font-bold text-background"
          >
            Entrar
          </Link>
          <p className="text-[13px] text-muted-foreground">
            senha em todos:{' '}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-foreground">
              senha-de-teste-123
            </code>
          </p>
        </div>
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
          dados são fictícios e as credenciais acima são públicas de propósito —
          qualquer visitante pode alterar o cardápio e as comandas. Nada aqui
          contém dado real de pessoa ou de estabelecimento.
        </p>
      </footer>
    </main>
  );
}
