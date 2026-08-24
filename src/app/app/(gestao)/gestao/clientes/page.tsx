import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Cartao, Celula, Linha, Numero, Tabela, Vazio } from '@/components/gestao/painel';
import { Telefone } from '@/components/gestao/telefone';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarClientes } from '@/lib/gestao/queries';
import { normalizarPeriodo } from '@/lib/gestao/periodo';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Clientes · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Quem passou pela casa (spec §8 e §10.9).
 *
 * O telefone chega aqui JÁ MASCARADO — mascarado no banco, por uma coluna
 * gerada, com a coluna crua revogada para `authenticated`. Não existe consulta
 * que devolva a lista de números inteiros, nem para o administrador; o valor
 * cheio sai um a um, pela função que confere o papel e grava quem olhou.
 *
 * A razão de ser assim: esta tela fica aberta no balcão. Uma lista de telefones
 * à vista não é a mesma coisa que consultar um telefone quando há motivo.
 */
export default async function Clientes({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const staff = await exigirStaff();
  if (!can(staff, 'dashboard.view')) forbidden();

  const periodo = normalizarPeriodo((await searchParams).periodo);
  const clientes = await carregarClientes(periodo);

  const comTelefone = clientes.filter((c) => c.temTelefone);
  const podeRevelar = can(staff, 'customer.view_full_phone');

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Clientes"
        descricao={`Quem passou pela casa nos últimos ${periodo} dias`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Numero rotulo="Pessoas" valor={String(clientes.length)} detalhe="identificadas na mesa" />
        <Numero
          rotulo="Deixaram telefone"
          valor={String(comTelefone.length)}
          detalhe={
            clientes.length > 0
              ? `${Math.round((comTelefone.length / clientes.length) * 100)}% das pessoas`
              : '—'
          }
        />
        <Numero
          rotulo="Com consentimento"
          valor={String(clientes.filter((c) => c.consentiuEm).length)}
          detalhe="LGPD registrada com data e hora"
          tom={
            comTelefone.length === clientes.filter((c) => c.consentiuEm).length
              ? 'bom'
              : 'ruim'
          }
        />
      </div>

      <Cartao titulo="Lista">
        {clientes.length === 0 ? (
          <Vazio>Ninguém se identificou no período.</Vazio>
        ) : (
          <>
            <Tabela colunas={['Nome', 'Telefone', 'Consentimento', 'Visitou em']}>
              {clientes.map((c) => (
                <Linha key={c.guestId}>
                  <Celula className="font-medium">{c.nome}</Celula>
                  <Celula>
                    {podeRevelar ? (
                      <Telefone guestId={c.guestId} mascarado={c.telefoneMascarado} />
                    ) : (
                      <span className="tabular-nums text-[13px] text-muted-foreground">
                        {c.telefoneMascarado ?? 'não deixou'}
                      </span>
                    )}
                  </Celula>
                  <Celula fraca>
                    {c.consentiuEm ? (
                      dataHora(c.consentiuEm)
                    ) : c.temTelefone ? (
                      <span className="text-alert-critical">sem registro</span>
                    ) : (
                      '—'
                    )}
                  </Celula>
                  <Celula fraca>{dataHora(c.visitouEm)}</Celula>
                </Linha>
              ))}
            </Tabela>

            <div className="mt-4 space-y-2 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">
                  O telefone está mascarado no banco, não na tela.
                </strong>{' '}
                A coluna com o número inteiro está revogada para todos os funcionários —
                inclusive para você. Ver um número usa uma função que confere a permissão e
                registra o acesso na auditoria, com hora e autor.
              </p>
              <p>
                O registro guarda <em>que</em> um telefone foi consultado, nunca o número.
                Gravar o valor no log criaria uma segunda cópia do dado pessoal numa tabela
                que ninguém pode apagar.
              </p>
            </div>
          </>
        )}
      </Cartao>
    </div>
  );
}

/** ISO → "23/08 às 20:14" no fuso do restaurante. */
function dataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
    .format(new Date(iso))
    .replace(', ', ' às ');
}
