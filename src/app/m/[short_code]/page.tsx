import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { MenuScreen } from '@/components/menu/menu-screen';
import { loadMenu } from '@/lib/menu/queries';

/**
 * Cardápio do cliente — a única rota pública que escreve dado de sessão
 * (a partir da Etapa 3).
 *
 * Sem login, sem splash: encostou o celular na tag, viu comida (spec §4).
 *
 * `params` é assíncrono no Next 16 — daí o await.
 */

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ short_code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { short_code } = await params;
  const menu = await loadMenu(short_code);

  if (!menu) return { title: 'Cardápio' };

  // White label: o título é do RESTAURANTE. É o que aparece na aba, no
  // compartilhamento e no histórico do celular do cliente.
  return {
    title: `${menu.restaurant.name} · ${menu.table.label}`,
    description: `Cardápio digital de ${menu.restaurant.name}. Peça direto da mesa.`,
    robots: { index: false, follow: false },
  };
}

export default async function MenuPage({ params }: Props) {
  const { short_code } = await params;

  // O short_code é nanoid de 10+ chars. Descartar formato inválido antes de
  // tocar o banco corta o custo de quem estiver varrendo códigos na força bruta.
  if (!/^[A-Za-z0-9_-]{10,32}$/.test(short_code)) notFound();

  const menu = await loadMenu(short_code);
  if (!menu) notFound();

  return (
    <MenuScreen
      menu={menu}
      shortCode={short_code}
      // brand_color vem do restaurante — nunca inventamos marca (spec §11)
      key={menu.restaurant.id}
    />
  );
}
