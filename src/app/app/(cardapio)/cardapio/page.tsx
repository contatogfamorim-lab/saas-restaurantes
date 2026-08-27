import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { ListaDeItens } from '@/components/cardapio/lista-de-itens';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarCategorias, carregarProdutos } from '@/lib/cardapio/queries';
import { canOpenMenuEditor, menuPermissions } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Cardápio · Pedidos.IA',
  robots: { index: false, follow: false },
};

/** Disponibilidade muda durante o serviço; cache aqui seria mentira. */
export const dynamic = 'force-dynamic';

/**
 * Os itens do cardápio (spec §12).
 *
 * A lista é ordenada por categoria e, dentro dela, com os itens FORA DO AR
 * primeiro. Não é capricho: quem abre esta tela no meio do serviço quase sempre
 * está procurando o que precisa voltar, e enterrar isso no fim de uma lista de
 * quarenta itens é o mesmo que esconder.
 */
export default async function Cardapio() {
  const staff = await exigirStaff();
  if (!canOpenMenuEditor(staff)) forbidden();

  const [produtos, categorias] = await Promise.all([
    carregarProdutos(),
    carregarCategorias(),
  ]);

  return (
    <ListaDeItens
      produtos={produtos}
      categorias={categorias}
      permissoes={menuPermissions(staff)}
    />
  );
}
