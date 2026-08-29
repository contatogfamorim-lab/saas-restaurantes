import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Cartao, Celula, Linha, Numero, Tabela, Vazio } from '@/components/gestao/painel';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarAcoesDeDinheiro, carregarEquipe } from '@/lib/gestao/queries';
import { normalizarPeriodo } from '@/lib/gestao/periodo';
import { formatCents } from '@/lib/money';
import { can, DISCOUNT_CEILING_PCT, type Role } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Equipe · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PAPEL: Record<string, string> = {
  owner: 'administrador',
  manager: 'gerente',
  waiter: 'garçom',
  kitchen: 'cozinha',
  cashier: 'caixa',
};

const ACAO: Record<string, string> = {
  discount: 'desconto',
  service_fee_waiver: 'taxa removida',
  force_release: 'mesa liberada com saldo',
};

export default async function Equipe({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const staff = await exigirStaff();
  // `staff.manage`, e não `dashboard.view`: é a mesma ação que a barra lateral
  // usa para decidir se mostra este item. Enquanto as duas discordarem, existe
  // um caminho para a barra oferecer o que a página recusa.
  if (!can(staff, 'staff.manage')) forbidden();

  const periodo = normalizarPeriodo((await searchParams).periodo);
  const [equipe, acoes] = await Promise.all([
    carregarEquipe(),
    carregarAcoesDeDinheiro(periodo),
  ]);

  const ativos = equipe.filter((f) => f.ativo);
  const totalDescontado = acoes
    .filter((a) => a.acao === 'discount')
    .reduce((s, a) => s + a.totalCents, 0);
  const liberacoesForcadas = acoes
    .filter((a) => a.acao === 'force_release')
    .reduce((s, a) => s + a.ocorrencias, 0);

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Equipe"
        descricao={`${ativos.length} pessoas ativas · ações de dinheiro dos últimos ${periodo} dias`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Numero
          rotulo="Pessoas ativas"
          valor={String(ativos.length)}
          detalhe={
            equipe.length > ativos.length
              ? `${equipe.length - ativos.length} desligadas`
              : 'ninguém desligado'
          }
        />
        <Numero
          rotulo="Descontado no período"
          valor={formatCents(totalDescontado)}
          detalhe="cortesias concedidas na conta"
          tom={totalDescontado > 0 ? 'alerta' : 'neutro'}
        />
        <Numero
          rotulo="Mesas liberadas com saldo"
          valor={String(liberacoesForcadas)}
          detalhe="conta em aberto na hora de liberar"
          tom={liberacoesForcadas > 0 ? 'alerta' : 'bom'}
        />
      </div>

      <Cartao titulo="Quem mexeu em dinheiro">
        {acoes.length === 0 ? (
          <Vazio>Nenhum desconto, taxa removida ou liberação forçada no período.</Vazio>
        ) : (
          <>
            <Tabela
              colunas={[
                'Pessoa',
                'Ação',
                { rotulo: 'Vezes', alinhar: 'direita' },
                { rotulo: 'Valor', alinhar: 'direita' },
              ]}
            >
              {acoes.map((a) => (
                <Linha key={`${a.profileId}-${a.acao}`}>
                  <Celula className="font-medium">{a.funcionario}</Celula>
                  <Celula fraca>{ACAO[a.acao] ?? a.acao}</Celula>
                  <Celula direita>{a.ocorrencias}</Celula>
                  <Celula direita fraca={a.totalCents === 0}>
                    {a.totalCents > 0 ? formatCents(a.totalCents) : '—'}
                  </Celula>
                </Linha>
              ))}
            </Tabela>

            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Não mede produtividade: são as ações que movem valor sem uma venda
              atrás. Número alto não é acusação, é onde vale perguntar.
            </p>
          </>
        )}
      </Cartao>

      <Cartao titulo="Cadastro" className="mt-4">
        <Tabela
          colunas={[
            'Nome',
            'Código',
            'Funções',
            { rotulo: 'Teto de desconto', alinhar: 'direita' },
            'Estado',
          ]}
        >
          {equipe.map((f) => (
            <Linha key={f.id}>
              <Celula className="font-medium">
                {f.nome}
                {f.id === staff.id && (
                  <span className="ml-2 text-[11px] text-muted-foreground">você</span>
                )}
              </Celula>
              <Celula fraca className="tabular-nums">
                {f.operatorCode ?? '—'}
              </Celula>
              <Celula>
                <span className="flex flex-wrap gap-1">
                  {f.roles.map((r) => (
                    <span
                      key={r}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                    >
                      {PAPEL[r] ?? r}
                    </span>
                  ))}
                  {f.roles.length === 0 && (
                    <span className="text-[11px] text-alert-warning">sem função</span>
                  )}
                </span>
              </Celula>
              <Celula direita fraca={teto(f.roles) === 0}>
                {teto(f.roles) > 0 ? `${teto(f.roles)}%` : '—'}
              </Celula>
              <Celula>
                {f.ativo ? (
                  <span className="text-[11px] text-muted-foreground">ativo</span>
                ) : (
                  <span className="rounded bg-alert-critical/15 px-1.5 py-0.5 text-[11px] font-semibold text-alert-critical">
                    desligado
                  </span>
                )}
              </Celula>
            </Linha>
          ))}
        </Tabela>

        <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Ninguém altera as próprias funções</strong>
          {' '}— nem o administrador.
        </p>
      </Cartao>
    </div>
  );
}

/** O teto vale pelo MAIOR papel acumulado (spec P1b). */
function teto(roles: string[]): number {
  return roles.reduce((max, r) => Math.max(max, DISCOUNT_CEILING_PCT[r as Role] ?? 0), 0);
}
