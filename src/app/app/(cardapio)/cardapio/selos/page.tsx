import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { EditorDeSelos } from '@/components/cardapio/editor-de-selos';
import { exigirStaff } from '@/lib/auth/staff';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Selos · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Selos do cardápio (§12).
 *
 * Eram quatro, fixos no código. Agora a casa cadastra os seus — "SEM GLÚTEN",
 * "PROMOÇÃO DA SEMANA", o que ela quiser anunciar — com cor e animação
 * próprias.
 */
export default async function SelosPage() {
  const staff = await exigirStaff();
  if (!can(staff, 'menu.content')) forbidden();

  const supabase = await createClient();
  const { data } = await supabase
    .from('product_badges')
    .select('id, slug, label, color, animation, active, built_in, sort_order')
    .order('sort_order');

  // Quantos produtos usam cada selo: é o que diz se dá para apagar, e o que
  // mostra à pessoa o tamanho do estrago antes de ela tentar.
  const { data: produtos } = await supabase.from('products').select('badges');

  const uso = new Map<string, number>();
  for (const p of produtos ?? []) {
    for (const slug of (p.badges ?? []) as string[]) {
      uso.set(slug, (uso.get(slug) ?? 0) + 1);
    }
  }

  return (
    <EditorDeSelos
      selos={(data ?? []).map((s) => ({
        id: s.id,
        slug: s.slug,
        label: s.label,
        color: s.color,
        animation: s.animation as 'none' | 'pulse' | 'shine' | 'bounce',
        ativo: s.active,
        interno: s.built_in,
        emUso: uso.get(s.slug) ?? 0,
      }))}
    />
  );
}
