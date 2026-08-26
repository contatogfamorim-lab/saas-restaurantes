import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ContaDoCliente } from '@/components/menu/conta-do-cliente';
import { createAdminClient } from '@/lib/supabase/admin';
import { lerContaDoCliente } from '@/lib/session/cliente';
import { readTableSession } from '@/lib/session/cookie';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Minha conta',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ short_code: string }>;
}

/**
 * A conta do cliente, dentro do cardápio.
 *
 * Rota própria e renderizada no SERVIDOR, e não um painel dentro do
 * `MenuScreen`: saldo é dinheiro, e dinheiro não passa pelo estado de um
 * componente de cliente. Tudo o que esta tela mostra foi calculado no banco.
 *
 * O que ela nunca recebe: valor de resgate. O botão manda "usar meu saldo" e
 * quem decide quanto é `resgatar_cashback` (§10.1).
 */
export default async function ContaPage({ params }: Props) {
  const { short_code } = await params;
  if (!/^[A-Za-z0-9_-]{10,32}$/.test(short_code)) notFound();

  const admin = createAdminClient();

  const { data: mesa } = await admin
    .from('restaurant_tables')
    .select('restaurant_id, label, restaurants(name, active, cashback_pct, brand_color)')
    .eq('short_code', short_code)
    .eq('active', true)
    .maybeSingle();

  const casa = mesa?.restaurants as unknown as {
    name: string;
    active: boolean;
    cashback_pct: number;
    brand_color: string;
  } | null;

  if (!mesa || !casa?.active) notFound();

  const conta = await lerContaDoCliente(mesa.restaurant_id);
  const sessao = await readTableSession();

  // Sem conta: a tela é o cadastro/login, e nada mais é consultado.
  if (!conta) {
    return (
      <ContaDoCliente
        shortCode={short_code}
        restaurante={casa.name}
        corDaMarca={casa.brand_color}
        cashbackPct={Number(casa.cashback_pct)}
      />
    );
  }

  const [{ data: disponivel }, { data: carencia }] = await Promise.all([
    admin.rpc('saldo_disponivel_do_cliente', { p_cliente: conta.clienteId }),
    admin.rpc('saldo_em_carencia_do_cliente', { p_cliente: conta.clienteId }),
  ]);

  // O ERRO É LIDO, e não descartado.
  //
  // A primeira versão só pegava `data`. Faltava o GRANT de `service_role` na
  // tabela, a consulta era negada, e a tela dizia "nada por aqui ainda" — com o
  // saldo certo logo acima, porque aquele vem de função `security definer`. Uma
  // tela que mente sobre dinheiro é pior que uma tela que falha.
  const { data: extrato, error: erroExtrato } = await admin
    .from('customer_cashback_ledger')
    .select('id, kind, amount_cents, available_at, base_cents, pct, created_at')
    .eq('customer_id', conta.clienteId)
    .order('created_at', { ascending: false })
    .limit(20);

  // A conta da mesa só é consultada se houver mesa aberta — quem abriu o
  // cardápio em casa para ver o saldo não tem sessão nenhuma.
  let bill: { totalCents: number; cashbackCents: number; tetoCents: number } | null = null;
  if (sessao) {
    const [{ data: totais }, { data: teto }] = await Promise.all([
      admin
        .from('session_totals')
        .select('total_cents, cashback_cents')
        .eq('session_id', sessao.sessionId)
        .maybeSingle(),
      admin.rpc('teto_de_resgate_do_cliente', {
        p_sessao: sessao.sessionId,
        p_cliente: conta.clienteId,
      }),
    ]);

    if (totais) {
      bill = {
        totalCents: totais.total_cents ?? 0,
        cashbackCents: totais.cashback_cents ?? 0,
        tetoCents: (teto as number | null) ?? 0,
      };
    }
  }

  return (
    <ContaDoCliente
      shortCode={short_code}
      restaurante={casa.name}
      corDaMarca={casa.brand_color}
      cashbackPct={Number(casa.cashback_pct)}
      nome={conta.nome}
      saldoCents={(disponivel as number | null) ?? 0}
      carenciaCents={(carencia as number | null) ?? 0}
      extratoIndisponivel={Boolean(erroExtrato)}
      extrato={(extrato ?? []).map((l) => ({
        id: l.id,
        tipo: l.kind as 'credito' | 'resgate',
        valorCents: l.amount_cents,
        liberaEm: l.available_at,
        baseCents: l.base_cents,
        pct: l.pct,
        quando: l.created_at,
      }))}
      conta={bill}
    />
  );
}
