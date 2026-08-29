import type { Metadata } from 'next';
import Link from 'next/link';
import { forbidden } from 'next/navigation';

import { Cabecalho } from '@/components/gestao/cabecalho';
import { Contatos } from '@/components/gestao/contatos';
import { exigirStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Contatos · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * A agenda do aparelho conectado.
 *
 * A tela diz, com todas as letras, que estas pessoas NÃO entram em campanha.
 * Não é excesso de zelo: uma lista de telefones dentro de um sistema que
 * dispara promoção é exatamente o lugar onde alguém supõe que dá para disparar
 * para todo mundo — e a lei brasileira e o bloqueio do WhatsApp cobram por
 * essa suposição.
 */
export default async function ContatosPage() {
  const staff = await exigirStaff();
  if (!can(staff, 'chat.view')) forbidden();

  const supabase = await createClient();

  const [contatos, casa] = await Promise.all([
    supabase
      .from('whatsapp_contacts')
      .select('id, jid, phone, nome, foto_url, visto_em')
      .order('nome', { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase
      .from('restaurants')
      .select('evolution_instance_name')
      .eq('id', staff.restaurantId)
      .single(),
  ]);

  if (contatos.error) throw new Error(`contatos: ${contatos.error.message}`);

  return (
    <div className="p-5">
      <Cabecalho titulo="Contatos" descricao="A agenda do WhatsApp conectado" />

      {!casa.data?.evolution_instance_name ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
          O WhatsApp não está conectado.{' '}
          <Link href="/app/gestao/configuracoes" className="underline">
            Conectar
          </Link>
        </p>
      ) : (
        <Contatos
          contatos={(contatos.data ?? []).map((c) => ({
            id: c.id as string,
            jid: c.jid as string,
            fone: (c.phone as string | null) ?? null,
            nome: (c.nome as string | null) ?? null,
            foto: (c.foto_url as string | null) ?? null,
            vistoEm: c.visto_em as string,
          }))}
        />
      )}
    </div>
  );
}
