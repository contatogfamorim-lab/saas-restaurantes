import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Cartao, Celula, Linha, Tabela, Vazio } from '@/components/gestao/painel';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarAuditoria } from '@/lib/gestao/queries';
import { formatCents } from '@/lib/money';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Auditoria · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const ACAO: Record<string, string> = {
  'discount.apply': 'aplicou desconto',
  'service_fee.remove': 'removeu a taxa de serviço',
  'payment.record': 'registrou pagamento',
  'table.force_release': 'liberou mesa com saldo em aberto',
  'customer.view_full_phone': 'consultou telefone de cliente',
  'product.price_change': 'alterou preço de produto',
  'order.reject': 'recusou item',
  'product.out_of_stock': 'marcou item como esgotado',
};

const ATOR: Record<string, string> = {
  staff: 'equipe',
  guest: 'cliente',
  system: 'sistema',
};

/**
 * Trilha de auditoria (spec §10.8).
 *
 * A tabela é IMUTÁVEL: inserir é permitido, alterar e apagar são negados para
 * todo mundo — administrador incluído. Não existe tela para editar isto porque
 * não existe caminho no banco para editar isto.
 *
 * Sem seletor de período no cabeçalho: auditoria se lê do fim para o começo, e
 * quem vem aqui procura o que aconteceu agora — não o resumo do mês.
 */
export default async function Auditoria() {
  const staff = await exigirStaff();

  // `audit.view` é de gerente e administrador; `dashboard.view` é só do
  // administrador. As duas são conferidas: quem chega nesta rota já passou pelo
  // portão do console, mas a permissão específica é esta.
  if (!can(staff, 'audit.view')) forbidden();

  const registros = await carregarAuditoria();

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Auditoria"
        descricao={`Últimos ${registros.length} registros, do mais recente para o mais antigo`}
        comPeriodo={false}
      />

      <Cartao titulo="Trilha">
        {registros.length === 0 ? (
          <Vazio>Nada registrado ainda.</Vazio>
        ) : (
          <>
            <Tabela colunas={['Quando', 'Quem', 'O quê', 'Detalhe']}>
              {registros.map((r) => (
                <Linha key={r.id}>
                  <Celula fraca className="whitespace-nowrap tabular-nums">
                    {dataHora(r.quando)}
                  </Celula>
                  <Celula className="whitespace-nowrap">
                    {r.quem}
                    {r.tipoDeAtor !== 'staff' && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        {ATOR[r.tipoDeAtor] ?? r.tipoDeAtor}
                      </span>
                    )}
                  </Celula>
                  <Celula>{ACAO[r.acao] ?? r.acao}</Celula>
                  <Celula fraca className="text-[12px]">
                    <Detalhe antes={r.antes} depois={r.depois} entidade={r.entidade} />
                  </Celula>
                </Linha>
              ))}
            </Tabela>

            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Esta tabela não pode ser alterada.</strong>{' '}
              Inserir é permitido; alterar e apagar são negados no banco para todos os
              papéis, administrador incluído — não é uma tela sem botão de editar, é uma
              porta que não existe. Dado pessoal nunca entra aqui: consulta de telefone
              registra o cliente, jamais o número.
            </p>
          </>
        )}
      </Cartao>
    </div>
  );
}

/**
 * Resumo legível do que mudou.
 *
 * Mostra os campos que interessam a quem audita — valor, motivo, papel — em vez
 * de despejar o JSON. O JSON continua no banco para quem precisar do detalhe
 * completo; a tela existe para alguém varrer cem linhas com o olho.
 */
function Detalhe({
  antes,
  depois,
  entidade,
}: {
  antes: unknown;
  depois: unknown;
  entidade: string;
}) {
  const d = (depois ?? {}) as Record<string, unknown>;
  const a = (antes ?? {}) as Record<string, unknown>;

  const partes: string[] = [];

  for (const campo of ['amount_cents', 'price_cents', 'total_cents']) {
    if (typeof d[campo] === 'number') {
      const de = typeof a[campo] === 'number' ? `${formatCents(a[campo] as number)} → ` : '';
      partes.push(`${de}${formatCents(d[campo] as number)}`);
    }
  }

  if (typeof d.percent === 'number') partes.push(`${d.percent}%`);
  if (typeof d.reason === 'string' && d.reason) partes.push(`"${d.reason}"`);
  if (typeof d.release_reason === 'string' && d.release_reason) partes.push(d.release_reason);
  if (d.revelado === true) partes.push('número exibido uma vez');

  if (partes.length === 0) return <span>{entidade}</span>;
  return <span>{partes.join(' · ')}</span>;
}

function dataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}
