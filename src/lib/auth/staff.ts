import 'server-only';

import { redirect } from 'next/navigation';

import {
  can,
  canMarkOutOfStock,
  canOpenMenuEditor,
  type Action,
  type Actor,
  type Role,
} from '@/lib/permissions';
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
  /**
   * O briefing (§14) ainda não foi respondido — restaurante recém-criado, sem
   * cardápio, sem fuso e sem taxa definida.
   *
   * Lido de `restaurants.briefing_at`, que é PERMANENTE, e não da existência da
   * linha em `restaurant_briefing`, que expira em 3 horas de propósito. Usar a
   * linha aqui faria o restaurante ser barrado na porta toda madrugada,
   * perguntando de novo o que ele já respondeu.
   */
  briefingPendente: boolean;
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
    .select('id, restaurant_id, name, roles, permissions, active, restaurants(name, brand_color, briefing_at)')
    .eq('id', user.id)
    .maybeSingle();

  // Funcionário desligado perde o acesso na hora, sem depender de revogar a
  // sessão do Supabase — que continuaria válida por horas.
  if (!perfil || !perfil.active) return null;

  const restaurante = perfil.restaurants as unknown as {
    name: string;
    brand_color: string;
    briefing_at: string | null;
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
    briefingPendente: restaurante != null && restaurante.briefing_at == null,
  };
}

/**
 * Por que `getStaff()` devolveu `null`.
 *
 * Os três motivos exigem destinos DIFERENTES, e tratá-los como um só produziu
 * um laço infinito entre `/app` e `/app/entrar` — tela preta, sem erro nenhum.
 *
 * O mecanismo: `exigirStaff` mandava todo mundo para a porta, e o `proxy.ts`
 * devolve para `/app` quem chega na porta COM sessão válida
 * (`lib/supabase/middleware.ts`). Duas regras discordando — o middleware
 * supondo que ter sessão é poder usar o app, e esta função mandando para a
 * porta gente cuja sessão é perfeitamente válida.
 */
type MotivoSemStaff = 'sem-sessao' | 'sem-perfil' | 'desativado';

async function porQueNaoTemStaff(): Promise<MotivoSemStaff> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return 'sem-sessao';

  const { data: perfil } = await supabase
    .from('profiles')
    .select('active')
    .eq('id', user.id)
    .maybeSingle();

  if (!perfil) return 'sem-perfil';
  return 'desativado';
}

/**
 * Exige alguém logado, com perfil ativo E com o briefing respondido.
 *
 * O briefing é obrigatório na primeira entrada, e o lugar de cobrar isso é
 * aqui: toda tela protegida e toda Server Action já passam por este funil. Pôr
 * a checagem num layout deixaria as Server Actions de fora — e Server Action é
 * endpoint HTTP público (§10.3), alcançável sem abrir tela nenhuma.
 *
 * Quem responde o briefing NÃO pode usar esta função, pela razão óbvia:
 * `responderBriefing` seria barrada pelo portão que ela existe para abrir. Ela
 * chama `getStaff()` direto.
 *
 * REGRA QUE NÃO PODE SER QUEBRADA: nunca mandar para `/app/entrar` alguém que
 * TEM sessão. O `proxy.ts` devolve essa pessoa para `/app` na mesma hora, e o
 * resultado é laço até o navegador desistir e pintar a tela de preto.
 */
export async function exigirStaff(): Promise<StaffSession> {
  const staff = await getStaff();

  if (staff) {
    if (staff.briefingPendente) redirect('/comecar');
    return staff;
  }

  // A consulta extra só acontece no caminho que já termina em redirecionamento,
  // então não custa nada em uso normal — e é o que evita o laço.
  switch (await porQueNaoTemStaff()) {
    case 'sem-sessao':
      redirect('/app/entrar');

    // Logado e sem perfil: é quem acabou de confirmar o e-mail, ou quem teve o
    // restaurante apagado junto com uma demonstração vencida. Não é falta de
    // autenticação, é onboarding pela metade — e o lugar dele é o wizard, que
    // vai pôr a pessoa no passo "criar restaurante".
    case 'sem-perfil':
      redirect('/comecar');

    // Desligado: o acesso foi revogado, então a sessão precisa acabar de fato.
    // Só redirecionar deixaria o cookie válido, e o middleware o devolveria
    // para `/app` — o mesmo laço, por outra porta.
    case 'desativado': {
      const supabase = await createClient();
      await supabase.auth.signOut();
      redirect('/app/entrar?erro=1');
    }
  }
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
    // Duas telas, e não uma com cadeados: "acabou" é operação da noite e cabe
    // a quase todo mundo; EDITAR o cardápio é decisão, e é ferramenta de quem
    // administra. Juntar as duas dava à cozinha um editor onde nada abria.
    disponibilidade: canMarkOutOfStock(staff),
    cardapio: canOpenMenuEditor(staff),
  };
}
