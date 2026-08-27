import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { EditorDeLayout } from '@/components/cardapio/editor-de-layout';
import { exigirStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Organizar cardápio · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Organizar o cardápio (§12.10).
 *
 * `menu_layouts` e `menu_blocks` existiam desde a 0009, com rascunho e
 * publicação versionada, e nunca tiveram tela. Esta é ela.
 *
 * O rascunho é criado na primeira visita: `ensure_draft_layout` copia o layout
 * vigente, se houver, para a pessoa mexer sem afetar quem está pedindo agora.
 */
export default async function LayoutDoCardapioPage() {
  const staff = await exigirStaff();
  if (!can(staff, 'menu.structure')) forbidden();

  const supabase = await createClient();

  // Garante o rascunho ANTES de ler: sem isto, a primeira visita mostraria
  // uma tela vazia e só criaria o rascunho no primeiro clique.
  const { error: erroRascunho } = await supabase.rpc('ensure_draft_layout');

  const { data: layouts } = await supabase
    .from('menu_layouts')
    .select('id, status, version, published_at')
    .order('version', { ascending: false });

  const rascunho = layouts?.find((l) => l.status === 'draft');
  const publicado = layouts?.find((l) => l.status === 'published');

  const { data: blocos } = rascunho
    ? await supabase
        .from('menu_blocks')
        .select('id, type, sort_order, config, is_hidden')
        .eq('layout_id', rascunho.id)
        .is('parent_block_id', null)
        .order('sort_order')
    : { data: [] };

  const { data: categorias } = await supabase
    .from('categories')
    .select('id, name, sort_order')
    .is('archived_at', null)
    .order('sort_order');

  return (
    <EditorDeLayout
      erro={erroRascunho?.message ?? null}
      podePublicar={can(staff, 'menu.publish')}
      temPublicado={Boolean(publicado)}
      blocos={(blocos ?? []).map((b) => ({
        id: b.id,
        tipo: b.type,
        oculto: b.is_hidden,
        config: (b.config ?? {}) as Record<string, unknown>,
      }))}
      categorias={(categorias ?? []).map((c) => ({ id: c.id, nome: c.name }))}
    />
  );
}
