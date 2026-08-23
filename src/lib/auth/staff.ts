import 'server-only';

import { redirect } from 'next/navigation';

import { can, type Action, type Actor, type Role } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

/**
 * Identidade da equipe — a fronteira de autorização REAL (spec §10.3).
 *
 * Toda página e toda Server Action da área `/app` começa por aqui. O
 * middleware só redireciona; quem decide é este módulo, junto com as policies
 * de RLS.
 *
 * "Server Actions são endpoints HTTP públicos": esconder o botão na interface
 * não protege nada. Se uma ação não chamou `exigirPermissao()`, ela está
 * desprotegida — não importa quão escondido esteja o botão que a dispara.
 */

export interface StaffSession extends Actor {
  id: string;
  restaurantId: string;
  name: string;
  roles: Role[];
  permissions: string[];
  active: boolean;
  restaurantName: string;
  restaurantBrandColor: string;
}

/** A equipe logada, ou `null`. Não redireciona — use em layout compartilhado. */
export async function getStaff(): Promise<StaffSession | null> {
  const supabase = await createClient();

  // getUser() valida o token no servidor de auth. getSession() só lê o cookie,
  // e cookie é exatamente o que não se pode acreditar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: perfil } = await supabase
    .from('profiles')
    .select('id, restaurant_id, name, roles, permissions, active, restaurants(name, brand_color)')
    .eq('id', user.id)
    .maybeSingle();

  // Funcionário desligado perde o acesso na hora, sem depender de revogar a
  // sessão do Supabase — que continuaria válida por horas.
  if (!perfil || !perfil.active) return null;

  const restaurante = perfil.restaurants as unknown as {
    name: string;
    brand_color: string;
  } | null;

  return {
    id: perfil.id,
    restaurantId: perfil.restaurant_id,
    name: perfil.name,
    roles: (perfil.roles ?? []) as Role[],
    permissions: perfil.permissions ?? [],
    active: true,
    restaurantName: restaurante?.name ?? '',
    restaurantBrandColor: restaurante?.brand_color ?? '#D97A28',
  };
}

/** Exige alguém logado. Redireciona para o login quando não há. */
export async function exigirStaff(): Promise<StaffSession> {
  const staff = await getStaff();
  if (!staff) redirect('/app/entrar');
  return staff;
}

/**
 * Exige uma permissão específica.
 *
 * Lança em vez de redirecionar: numa Server Action, redirecionar mascararia a
 * negação como se fosse navegação normal, e o chamador acharia que deu certo.
 */
export async function exigirPermissao(acao: Action): Promise<StaffSession> {
  const staff = await exigirStaff();
  if (!can(staff, acao)) {
    throw new Error(`Sem permissão para ${acao}`);
  }
  return staff;
}

/**
 * Quais telas cada pessoa enxerga.
 *
 * UMA tela por função. Quem acumula funções (spec P1b) vê as duas e alterna,
 * mas ninguém ganha tela de tabela por efeito colateral de uma permissão
 * pontual.
 *
 * O caso que isto corrige: `table.release` pertence ao caixa, e usá-lo como
 * critério fazia o caixa enxergar o mapa do salão inteiro. Ele libera mesa —
 * pela tela DELE (spec §5), com a mesma função e o mesmo endpoint.
 */
export function telasVisiveis(staff: StaffSession) {
  return {
    salao: can(staff, 'order.approve'),
    cozinha: can(staff, 'kds.advance_item'),
    caixa: can(staff, 'payment.record'),
    // Gestão não aparece na navegação das outras telas (spec §8).
    gestao: can(staff, 'dashboard.view'),
  };
}
