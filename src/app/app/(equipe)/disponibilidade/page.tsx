import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { PainelDeDisponibilidade } from '@/components/app/painel-de-disponibilidade';
import { exigirStaff } from '@/lib/auth/staff';
import { carregarCategorias, carregarProdutos } from '@/lib/cardapio/queries';
import { canMarkOutOfStock } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Zerou · Markello',
  robots: { index: false, follow: false },
};

/** O que acabou muda no meio do serviço; cache aqui seria mentira. */
export const dynamic = 'force-dynamic';

/**
 * "Acabou" — a tela da equipe (spec §12).
 *
 * Faz UMA coisa: ligar e desligar item. Nem preço, nem foto, nem categoria.
 *
 * Vive dentro da casca `(equipe)` porque é operação, não gestão: acontece de pé,
 * no meio do serviço, com o tablet na parede ou o celular na mão. O editor de
 * verdade é outra tela, com outra casca e outra permissão.
 *
 * A separação nasceu de olhar a tela: quando as duas eram a mesma, a cozinha
 * abria o editor e via seis campos com cadeado e um "Salvar" que não salvava
 * nada. Uma tela cujo único uso é descobrir que você não pode.
 */
export default async function Disponibilidade() {
  const staff = await exigirStaff();

  if (!canMarkOutOfStock(staff)) forbidden();

  const [produtos, categorias] = await Promise.all([
    carregarProdutos(),
    carregarCategorias(),
  ]);

  return (
    <PainelDeDisponibilidade
      produtos={produtos.filter((p) => !p.arquivado)}
      categorias={categorias}
    />
  );
}
