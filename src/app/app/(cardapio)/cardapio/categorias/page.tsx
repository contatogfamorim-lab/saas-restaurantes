import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { EditorDeCategorias } from '@/components/cardapio/editor-de-categorias';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarCategorias } from '@/lib/cardapio/queries';
import { can } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Categorias · Pedidos.IA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Estrutura do cardápio (spec §12).
 *
 * A janela de serviço mora aqui e não no item: "Almoço 11h–15h" é uma decisão
 * da seção inteira, e repetir horário item a item é onde a divergência nasce —
 * um prato que ficou de fora da mudança e aparece fora de hora.
 */
export default async function Categorias() {
  const staff = await exigirStaff();

  // Categoria é estrutura. Quem só tem `menu.availability` não chega aqui —
  // e a policy `categories_staff_write` recusaria de qualquer forma.
  if (!can(staff, 'menu.structure')) forbidden();

  const categorias = await carregarCategorias();

  return <EditorDeCategorias categorias={categorias} />;
}
