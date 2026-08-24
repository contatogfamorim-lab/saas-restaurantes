import { formatCents } from '@/lib/money';
import type { MudancaDoItem } from '@/lib/cardapio/queries';

/**
 * O que já mudou neste item (spec §10.8).
 *
 * Fica AQUI, na tela de edição, e não escondido numa aba de auditoria: quem
 * está prestes a mexer no preço é exatamente quem precisa ver que ele mudou
 * três vezes esta semana. Trilha que só aparece depois do prejuízo chega tarde.
 *
 * Para quem não é gerente ou dono, a lista volta vazia — a policy `audit_log_read`
 * decide isso, não este componente. Vazio é a resposta certa: não é um erro,
 * é a informação de que não há nada a mostrar para aquela pessoa.
 */
const ROTULOS: Record<string, string> = {
  'product.created': 'criou o item',
  'product.price_changed': 'mudou o preço',
  'product.content_changed': 'mudou o conteúdo',
  'product.available': 'colocou no ar',
  'product.unavailable': 'marcou como esgotado',
  'product.archived': 'arquivou',
  'product.restored': 'desarquivou',
};

const QUANDO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

export function HistoricoDoItem({ mudancas }: { mudancas: MudancaDoItem[] }) {
  if (mudancas.length === 0) return null;

  return (
    <section>
      <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Histórico
      </h2>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {mudancas.map((m, i) => (
          <li key={`${m.quando}-${i}`} className="flex items-baseline gap-2 px-3 py-2">
            <span className="tabular shrink-0 text-[11px] text-muted-foreground">
              {QUANDO.format(new Date(m.quando))}
            </span>
            <span className="min-w-0 flex-1 text-[13px]">
              <strong className="font-semibold">{m.quem}</strong>{' '}
              {ROTULOS[m.acao] ?? m.acao}
              {detalhe(m)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Só a diferença que importa, e só quando ela é legível numa linha. */
function detalhe(m: MudancaDoItem): string {
  if (m.acao === 'product.price_changed') {
    const de = m.antes?.price_cents;
    const para = m.depois?.price_cents;
    if (typeof de === 'number' && typeof para === 'number') {
      return `: ${formatCents(de)} → ${formatCents(para)}`;
    }
  }

  if (m.acao === 'product.content_changed') {
    const campos: string[] = [];
    if (m.depois?.name !== undefined) campos.push('nome');
    if (m.depois?.description !== undefined) campos.push('descrição');
    if (m.depois?.foto !== undefined) campos.push('foto');
    if (campos.length > 0) return `: ${campos.join(', ')}`;
  }

  return '';
}
