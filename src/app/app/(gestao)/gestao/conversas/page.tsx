import type { Metadata } from 'next';
import Link from 'next/link';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Conversas } from '@/components/gestao/conversas';
import { exigirStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Conversas · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * A caixa de entrada do WhatsApp da casa.
 *
 * As mensagens chegam pelo webhook (`/api/webhooks/evolution`), não por consulta
 * à Evolution: uma tela que fosse buscar lá a cada abertura ficaria lenta e
 * pararia de funcionar assim que o servidor da Evolution engasgasse. Aqui o
 * banco é a verdade, e a tela só lê.
 */
export default async function ConversasPage({
  searchParams,
}: {
  searchParams: Promise<{ jid?: string }>;
}) {
  const staff = await exigirStaff();
  if (!can(staff, 'chat.view')) forbidden();

  const { jid } = await searchParams;
  const supabase = await createClient();

  const [lista, casa] = await Promise.all([
    supabase
      .from('conversas_do_whatsapp')
      .select('*')
      .order('ultima_em', { ascending: false })
      .limit(200),
    supabase
      .from('restaurants')
      .select('evolution_instance_name')
      .eq('id', staff.restaurantId)
      .single(),
  ]);

  // Engolir o erro mostraria "nenhuma conversa" para um problema de permissão,
  // e vazio é uma resposta plausível — ninguém desconfiaria. Já aconteceu neste
  // projeto, com o extrato de cashback e com a ficha técnica.
  if (lista.error) throw new Error(`conversas: ${lista.error.message}`);

  const aberta = jid ?? (lista.data?.[0]?.jid as string | undefined) ?? null;

  const mensagens = aberta
    ? await supabase
        .from('whatsapp_messages')
        .select('id, direcao, corpo, tipo_midia, status, enviada_em')
        .eq('jid', aberta)
        .order('enviada_em', { ascending: true })
        .limit(500)
    : { data: [], error: null };

  if (mensagens.error) throw new Error(`mensagens: ${mensagens.error.message}`);

  return (
    <div className="p-5">
      <Cabecalho
        titulo="Conversas"
        descricao="O WhatsApp da casa, do jeito que chega"
      />

      {!casa.data?.evolution_instance_name ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
          O WhatsApp não está conectado.{' '}
          <Link href="/app/gestao/configuracoes" className="underline">
            Conectar
          </Link>
        </p>
      ) : (
        <Conversas
          conversas={(lista.data ?? []).map((c) => ({
            jid: c.jid as string,
            nome: (c.nome as string | null) ?? null,
            fone: (c.phone as string | null) ?? null,
            ultimoCorpo: (c.ultimo_corpo as string | null) ?? '',
            ultimaDirecao: (c.ultima_direcao as string | null) ?? 'entrada',
            ultimaEm: c.ultima_em as string,
            naoLidas: Number(c.nao_lidas ?? 0),
          }))}
          aberta={aberta}
          mensagens={(mensagens.data ?? []).map((m) => ({
            id: m.id as string,
            direcao: m.direcao as 'entrada' | 'saida',
            corpo: m.corpo as string,
            midia: (m.tipo_midia as string | null) ?? null,
            status: m.status as string,
            em: m.enviada_em as string,
          }))}
          podeEnviar={can(staff, 'chat.send')}
        />
      )}
    </div>
  );
}
