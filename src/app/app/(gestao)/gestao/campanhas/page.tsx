import type { Metadata } from 'next';
import Link from 'next/link';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Campanhas } from '@/components/gestao/campanhas';
import { Gatilhos, type Gatilho } from '@/components/gestao/gatilhos';
import { exigirStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Campanhas · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Campanhas de WhatsApp.
 *
 * A tela existe para tornar visível o que o banco já recusa. Três números
 * ficam no alto, e nenhum deles é decoração:
 *
 *  - QUANTAS PESSOAS PODEM RECEBER. Um botão de disparar que não diz para
 *    quantos vai é como é que se manda mensagem para a base inteira sem querer;
 *
 *  - SE O WHATSAPP ESTÁ LIGADO. Sem instância, `iniciar_campanha` recusa. Sem
 *    este aviso, a pessoa escreveria a campanha inteira para descobrir no
 *    último clique;
 *
 *  - QUANTAS JÁ SAÍRAM HOJE, contra o teto. É o número que explica por que uma
 *    campanha "parou sozinha" — e sem ele o dono abriria um chamado.
 */
export default async function CampanhasPage() {
  const staff = await exigirStaff();

  // O layout já checou `dashboard.view`, e esta linha repete de propósito:
  // layout não é fronteira de rota (§10.3).
  if (!can(staff, 'campaign.manage')) forbidden();

  const supabase = await createClient();

  const [campanhas, publico, casa, hoje] = await Promise.all([
    supabase
      .from('campanhas_com_progresso')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('publico_de_marketing')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('restaurants')
      .select('evolution_instance_name, marketing_max_por_dia, cashback_validade_dias, marketing_max_por_cliente_mes')
      .maybeSingle(),
    supabase
      .from('message_campaign_targets')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('sent_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);

  // Engolir o erro mostraria "nenhuma campanha" para um problema de permissão,
  // e zero é uma resposta plausível — ninguém desconfiaria. Já aconteceu neste
  // projeto, com o extrato de cashback.
  // A contagem por gatilho sai das MESMAS campanhas já carregadas acima — a
  // view devolve `trigger_kind` desde a 0057. Uma segunda consulta traria os
  // mesmos dados por outro caminho, e os dois discordariam no dia em que
  // alguém mudasse o `limit` de um só.
  const gatilhos = await supabase
    .from('message_triggers')
    .select('kind, ativo, corpo, dias');

  if (campanhas.error) throw new Error(`campanhas: ${campanhas.error.message}`);
  if (gatilhos.error) throw new Error(`gatilhos: ${gatilhos.error.message}`);
  if (publico.error) throw new Error(`público: ${publico.error.message}`);

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Campanhas"
        descricao="Mensagens de WhatsApp para quem autorizou receber"
      />

      <Campanhas
        campanhas={(campanhas.data ?? []).map((c) => ({
          id: c.id as string,
          titulo: c.titulo as string,
          corpo: c.corpo as string,
          status: c.status as string,
          agendadaPara: c.scheduled_at as string | null,
          proximoEnvio: c.next_send_at as string | null,
          ultimoErro: c.last_error as string | null,
          criadaEm: c.created_at as string,
          total: Number(c.total ?? 0),
          enviados: Number(c.enviados ?? 0),
          pendentes: Number(c.pendentes ?? 0),
          falharam: Number(c.falharam ?? 0),
          pulados: Number(c.pulados ?? 0),
          segmento: (c.segmento as { tipo: 'todos' } | null) ?? { tipo: 'todos' },
        }))}
        publico={publico.count ?? 0}
        whatsapp={casa.data?.evolution_instance_name ?? null}
        tetoDiario={casa.data?.marketing_max_por_dia ?? 0}
        enviadasHoje={hoje.count ?? 0}
      />

      <div className="mt-6 border-t border-border pt-5">
        <GatilhosDaCasa
          linhas={gatilhos.data ?? []}
          enviadas={contarPorGatilho(campanhas.data ?? [])}
          temValidade={Number(casa.data?.cashback_validade_dias ?? 0) > 0}
          teto={Number(casa.data?.marketing_max_por_cliente_mes ?? 4)}
        />
      </div>

      <div className="mt-6 space-y-2 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">
            Só recebe quem marcou que aceita.
          </strong>{' '}
          Ninguém é incluído por ter deixado o telefone na mesa — aquilo autoriza
          contato sobre o pedido, não promoção. E quem sair da lista depois de a
          campanha começar é <em>pulado</em> no meio do caminho, não no começo:
          a permissão é conferida no instante de cada envio.
        </p>
        <p>
          <strong className="text-foreground">O link de saída vai sempre.</strong>{' '}
          Você não precisa escrever, e não consegue tirar — ele é colado ao final
          de cada mensagem, com um endereço próprio para cada pessoa.
        </p>
        <p>
          As mensagens saem uma a uma, com um intervalo de 40 a 90 segundos entre
          elas, e no máximo{' '}
          <strong className="text-foreground">
            {casa.data?.marketing_max_por_dia ?? 0} por dia
          </strong>
          . Não é lentidão: é o que evita o número da casa ser bloqueado.{' '}
          <Link href="/app/gestao/configuracoes" className="underline">
            Mudar em Configurações
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

/** Quantas mensagens cada gatilho já mandou, somando as campanhas dele. */
function contarPorGatilho(
  campanhas: { trigger_kind?: string | null; enviados?: number | null }[],
): Record<string, number> {
  const conta: Record<string, number> = {};
  for (const c of campanhas) {
    if (!c.trigger_kind) continue;
    conta[c.trigger_kind] = (conta[c.trigger_kind] ?? 0) + Number(c.enviados ?? 0);
  }
  return conta;
}

/**
 * Os três avisos, sempre os três.
 *
 * A tela mostra os que a casa nunca tocou junto com os configurados: o valor
 * disto é justamente a pessoa DESCOBRIR que existe um aviso de "cashback
 * liberado". Uma lista que só mostra o que já foi criado nunca ensina nada.
 */
function GatilhosDaCasa({
  linhas,
  enviadas,
  temValidade,
  teto,
}: {
  linhas: { kind: string; ativo: boolean; corpo: string; dias: number }[];
  enviadas: Record<string, number>;
  temValidade: boolean;
  teto: number;
}) {
  const PADRAO: Record<string, string> = {
    liberou:
      'Oi {nome}! Seu cashback de {saldo} já está liberado para usar. Te esperamos 😊',
    vai_expirar:
      'Oi {nome}, parte do seu cashback está perto de expirar. Você tem {saldo} para usar — vem aproveitar!',
    sumido:
      'Oi {nome}, faz tempo que você não aparece — e a gente sentiu falta. Vem tomar um café por nossa conta?',
  };

  const lista: Gatilho[] = (['liberou', 'vai_expirar', 'sumido'] as const).map((kind) => {
    const l = linhas.find((x) => x.kind === kind);
    return {
      kind,
      ativo: Boolean(l?.ativo),
      corpo: l?.corpo ?? PADRAO[kind],
      dias: l?.dias ?? 60,
      enviadas: enviadas[kind] ?? 0,
    };
  });

  return <Gatilhos gatilhos={lista} temValidade={temValidade} tetoPorPessoa={teto} />;
}
