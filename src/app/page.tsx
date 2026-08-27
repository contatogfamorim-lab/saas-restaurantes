import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRightIcon, QrCodeIcon } from 'lucide-react';

import { createAdminClient } from '@/lib/supabase/admin';

export const metadata: Metadata = {
  title: 'Markello — pedidos por mesa',
  description: 'O cliente pede pelo celular, o garçom aprova, a cozinha produz.',
};

/** A demonstração precisa do estado atual do banco; cache aqui mostraria mesa errada. */
export const dynamic = 'force-dynamic';

/**
 * Porta de entrada.
 *
 * A versão anterior explicava a arquitetura — RLS, congelamento de preço,
 * auditoria imutável — em quatro parágrafos densos. Nada daquilo é falso, e
 * nada daquilo é lido: quem abre um link de demonstração quer VER a coisa
 * funcionando, não ler sobre ela.
 *
 * A página agora faz uma coisa só: pôr a pessoa dentro do produto em um toque.
 * Duas portas, e a do cliente vem primeiro porque é a que não pede nada.
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
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-14">
      <header>
        <p className="font-display text-[15px] text-brand">Markello</p>
        <h1 className="font-display mt-3 text-[38px] leading-[1.05] sm:text-[46px]">
          O cliente pede
          <br />
          pelo celular.
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-muted-foreground">
          Do QR na mesa ao fechamento da conta.
        </p>
      </header>

      <div className="mt-9 space-y-3">
        {mesa && (
          <Link
            href={`/m/${mesa.short_code}`}
            className="flex items-center gap-4 rounded-2xl border-2 border-brand bg-card p-5 transition-colors active:bg-secondary/40"
          >
            <QrCodeIcon className="size-7 shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="font-display block text-xl leading-tight">
                Ver o cardápio
              </span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
                É o que abre ao apontar a câmera para a mesa
              </span>
            </span>
            <ArrowRightIcon className="size-5 shrink-0 text-brand" />
          </Link>
        )}

        <Link
          href="/comecar"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-colors active:bg-secondary/40"
        >
          <span className="min-w-0 flex-1">
            <span className="font-display block text-xl leading-tight">
              Montar meu restaurante
            </span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">
              Pronto em um minuto, com movimento simulado
            </span>
          </span>
          <ArrowRightIcon className="size-5 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <p className="mt-8 text-[13px] text-muted-foreground">
        Já tem conta?{' '}
        <Link href="/app/entrar" className="font-semibold text-foreground underline">
          Entrar
        </Link>
      </p>

      <footer className="mt-auto pt-12">
        <p className="text-[12px] text-muted-foreground">
          Demonstração de {restaurante}. Dados fictícios.
        </p>
      </footer>
    </main>
  );
}
