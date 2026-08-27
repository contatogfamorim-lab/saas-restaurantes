import type { Metadata } from 'next';
import { forbidden, notFound } from 'next/navigation';

import { EditorDeItem } from '@/components/cardapio/editor-de-item';
import { exigirStaff } from '@/lib/auth/staff';
import {
  carregarCategorias,
  carregarHistorico,
  carregarEtiquetas,
  carregarProduto,
} from '@/lib/cardapio/queries';
import { canOpenMenuEditor, menuPermissions } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Editar item · Markello',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function EditarItem({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await exigirStaff();
  if (!canOpenMenuEditor(staff)) forbidden();

  const { id } = await params;

  const [produto, categorias, historico, etiquetas] = await Promise.all([
    carregarProduto(id),
    carregarCategorias(),
    carregarHistorico(id),
    carregarEtiquetas(),
  ]);

  // `carregarProduto` volta nulo tanto para item inexistente quanto para item
  // de OUTRO restaurante — a RLS não distingue, e é bom que não distinga: um
  // 404 diferente de um 403 contaria que o id existe em algum lugar.
  if (!produto) notFound();

  return (
    <EditorDeItem
      produto={produto}
      categorias={categorias}
      historico={historico}
      permissoes={menuPermissions(staff)}
      selos={etiquetas.selos}
      restricoes={etiquetas.restricoes}
    />
  );
}
