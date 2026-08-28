/**
 * Matriz de permissão — FONTE ÚNICA DA VERDADE (spec §10.3).
 *
 * Nada de `if (role === 'owner')` espalhado pelo código. Toda decisão de
 * autorização da aplicação passa por `can()`.
 *
 * Este arquivo é espelhado por `app.has_menu_permission()` no banco
 * (migration 0013). A duplicação é deliberada: são duas camadas de aplicação,
 * e a API pode ser contornada — a policy do Postgres, não.
 *
 * Regra que atravessa tudo: `roles` é ARRAY. Um funcionário acumula funções
 * (spec P1b), então a checagem é sempre pertinência, nunca igualdade.
 */

export const ROLES = ['owner', 'manager', 'waiter', 'kitchen', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

/** Concessões delegadas do editor de cardápio (spec §12.9). */
export const DELEGATABLE_PERMISSIONS = [
  'menu.availability',
  'menu.content',
  'menu.price',
  'menu.structure',
  'menu.publish',
  'menu.promotion',
] as const;
export type DelegatablePermission = (typeof DELEGATABLE_PERMISSIONS)[number];

export const ACTIONS = [
  // pedido
  'order.approve',
  'order.reject',
  'order.create_for_table',
  'order.release_course',
  // produção
  'kds.advance_item',
  'product.mark_out_of_stock',
  // dinheiro
  'payment.record',
  'service_fee.remove',
  'discount.apply',
  // mesa
  'table.open',
  'table.release',
  'table.force_release',
  // gestão
  'dashboard.view',
  'customer.view_full_phone',
  'customer.export',
  'staff.manage',
  'audit.view',
  'restaurant.settings',
  'campaign.manage',
  'stock.manage',
  'stock.waste',
  // cardápio (delegáveis)
  ...DELEGATABLE_PERMISSIONS,
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Papéis que já vêm com a ação por padrão.
 * Uma ação delegável pode ainda ser concedida pessoa a pessoa via
 * `profiles.permissions` — ver `can()`.
 */
export const PERMISSION_MATRIX: Readonly<Record<Action, readonly Role[]>> = {
  'order.approve':            ['waiter', 'manager', 'owner'],
  'order.reject':             ['waiter', 'manager', 'owner'],
  'order.create_for_table':   ['waiter', 'manager', 'owner'],
  'order.release_course':     ['waiter', 'manager', 'owner'],

  // Avançar item na produção é da COZINHA. O garçom entrega (mark_item_delivered),
  // que é outra coisa: um garçom marcando "pronto" pelo celular anula a razão de
  // existir do KDS — a tela deixa de refletir a chapa.
  'kds.advance_item':         ['kitchen', 'manager', 'owner'],
  'product.mark_out_of_stock':['kitchen', 'waiter', 'manager', 'owner'],

  'payment.record':           ['cashier', 'manager', 'owner'],
  'service_fee.remove':       ['cashier', 'manager', 'owner'],
  // o TETO por função é percentual — ver canApplyDiscount()
  'discount.apply':           ['cashier', 'manager', 'owner'],

  'table.open':               ['waiter', 'cashier', 'manager', 'owner'],
  'table.release':            ['waiter', 'cashier', 'manager', 'owner'],
  'table.force_release':      ['manager', 'owner'],

  'dashboard.view':           ['owner'],
  'customer.view_full_phone': ['manager', 'owner'],
  'customer.export':          ['owner'],
  'staff.manage':             ['owner'],
  'audit.view':               ['manager', 'owner'],
  // Taxa de serviço e cashback saem do bolso da casa; nem gerente mexe.
  'restaurant.settings':      ['owner'],

  'menu.availability':        ['kitchen', 'waiter', 'manager', 'owner'],
  'menu.content':             ['manager', 'owner'],
  'menu.structure':           ['manager', 'owner'],
  'menu.promotion':           ['manager', 'owner'],
  // alterar preço é o vetor de fraude mais comum (spec §12.9): só o dono,
  // e delegável pessoa a pessoa
  'menu.price':               ['owner'],
  'menu.publish':             ['owner'],

  // Escrever e disparar campanha. Gerente entra porque é quem conhece o
  // movimento da casa e sabe quando vale chamar gente.
  //
  // O que gerente NÃO faz é ligar o WhatsApp a uma instância: isso é
  // `restaurant.settings`, de dono, porque errar a instância manda a campanha
  // pelo número de outro restaurante.
  'campaign.manage':          ['manager', 'owner'],

  // Estoque é rotina de gerente, e perda é a cozinha que vê acontecer. O
  // CUSTO, que é dinheiro, aparece na mesma tela — e por isso a cozinha não
  // entra aqui: ela registra perda pela própria tela, em `/app/perdas`.
  'stock.manage':             ['manager', 'owner'],
  'stock.waste':              ['kitchen', 'manager', 'owner'],
} as const;

/** Teto de desconto por função, em pontos percentuais (spec §10.3). */
export const DISCOUNT_CEILING_PCT: Readonly<Partial<Record<Role, number>>> = {
  cashier: 10,
  manager: 100,
  owner: 100,
} as const;

export interface Actor {
  readonly id: string;
  readonly restaurantId: string;
  readonly roles: readonly Role[];
  /** Concessões delegadas de `profiles.permissions`. */
  readonly permissions?: readonly string[];
  readonly active?: boolean;
}

function isDelegatable(action: Action): action is DelegatablePermission {
  return (DELEGATABLE_PERMISSIONS as readonly string[]).includes(action);
}

/**
 * O funcionário pode executar esta ação?
 *
 * Funcionário inativo não pode nada — desligar alguém tem que cortar o acesso
 * na hora, sem depender de revogar sessão.
 */
export function can(actor: Actor | null | undefined, action: Action): boolean {
  if (!actor) return false;
  if (actor.active === false) return false;
  if (!actor.roles?.length) return false;

  if (isDelegatable(action) && actor.permissions?.includes(action)) {
    return true;
  }

  const allowed = PERMISSION_MATRIX[action];
  if (!allowed) return false;
  return actor.roles.some((role) => allowed.includes(role));
}

/**
 * Quais permissões de cardápio esta pessoa tem, considerando as delegadas.
 *
 * O editor usa isto para mostrar cada campo no estado certo — preço travado
 * para quem não pode precificar, com o motivo à vista em vez de um erro depois
 * de digitar.
 *
 * Isso é CONVENIÊNCIA, não proteção. Quem manda são a policy e o
 * `products_column_guard`, no banco: campo desabilitado no HTML não impede
 * ninguém de mandar o POST na mão.
 */
export function menuPermissions(
  actor: Actor | null | undefined,
): DelegatablePermission[] {
  return DELEGATABLE_PERMISSIONS.filter((p) => can(actor, p));
}

/**
 * As permissões que EDITAM o cardápio — todas menos disponibilidade.
 *
 * `menu.availability` é a única que não muda o cardápio, só liga e desliga o
 * que já existe. É a operação da noite: a cozinha diz que acabou o cheddar e o
 * item some até alguém religar. Nada ali é decisão de cardápio.
 *
 * A separação define duas telas: a equipe recebe uma lista de ligar e desligar,
 * e o editor de verdade é ferramenta de quem administra.
 */
export const MENU_EDIT_PERMISSIONS = [
  'menu.content',
  'menu.price',
  'menu.structure',
  'menu.publish',
  'menu.promotion',
] as const satisfies readonly DelegatablePermission[];

/**
 * Abre o editor de cardápio?
 *
 * Repare que `menu.availability` NÃO entra. Não é para tirar poder da cozinha —
 * ela continua marcando esgotado, na tela dela e no KDS. É que um editor com
 * todos os campos cadeados não é um editor, é uma tela de aviso: foi
 * exatamente o que a cozinha via antes desta separação.
 *
 * Na matriz padrão isto dá gerente e administrador. Mas continua sendo
 * permissão, e não papel: o administrador delega `menu.price` a alguém e essa
 * pessoa passa a abrir o editor (spec §12.9). Amarrar em `roles.includes('owner')`
 * mataria a delegação, que é o motivo de a §12.9 existir.
 */
export function canOpenMenuEditor(actor: Actor | null | undefined): boolean {
  return MENU_EDIT_PERMISSIONS.some((p) => can(actor, p));
}

/** Liga e desliga item — a tela da equipe. */
export function canMarkOutOfStock(actor: Actor | null | undefined): boolean {
  return can(actor, 'menu.availability');
}

/**
 * Desconto tem duas portas: poder descontar, e poder descontar TANTO.
 * Caixa vai até 10%; acima disso exige gerente ou dono.
 */
export function canApplyDiscount(
  actor: Actor | null | undefined,
  percent: number,
): boolean {
  if (!can(actor, 'discount.apply')) return false;
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return false;

  const ceiling = actor!.roles.reduce(
    (max, role) => Math.max(max, DISCOUNT_CEILING_PCT[role] ?? 0),
    0,
  );
  return percent <= ceiling;
}

/**
 * Liberar mesa: o caminho normal exige saldo zerado; com saldo em aberto vira
 * liberação forçada, que só gerente ou dono faz — e sempre com motivo.
 *
 * Mesma função para a tela do garçom e a do caixa (spec §5): em casa pequena
 * é a mesma pessoa. Uma regra só, um endpoint só.
 */
export function canReleaseTable(
  actor: Actor | null | undefined,
  balanceCents: number,
): boolean {
  return balanceCents <= 0
    ? can(actor, 'table.release')
    : can(actor, 'table.force_release');
}

/**
 * Ninguém altera os próprios roles ou permissions. Nem o owner (spec §10.3).
 * Escalonamento de privilégio começa exatamente aí.
 *
 * O banco repete esta regra no trigger `forbid_self_role_escalation`, que
 * também vale para service_role.
 */
export function canEditStaffRoles(
  actor: Actor | null | undefined,
  targetProfileId: string,
): boolean {
  if (!can(actor, 'staff.manage')) return false;
  return actor!.id !== targetProfileId;
}

/** Todo acesso é escopado por restaurante. Tenant diferente é sempre 403. */
export function isSameTenant(
  actor: Actor | null | undefined,
  restaurantId: string,
): boolean {
  return Boolean(actor?.restaurantId) && actor!.restaurantId === restaurantId;
}

/**
 * Telefone mascarado por padrão (spec §10.9). Só manager/owner veem inteiro,
 * e o acesso ao valor completo vai para audit_log.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••••-${digits.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// AS SEÇÕES DO CONSOLE
// ---------------------------------------------------------------------------

/**
 * Quais seções da gestão a pessoa abre.
 *
 * Existe porque eu criei duas permissões que não valiam nada. `campaign.manage`
 * dava campanha ao gerente, e `movimentar_estoque` dava estoque ao gerente e à
 * cozinha — mas o console inteiro cobrava `dashboard.view`, que é só do dono.
 * A capacidade existia no banco e não tinha porta.
 *
 * A saída não é afrouxar o console: é cada seção ter o próprio portão, e o
 * console admitir quem abre PELO MENOS UMA. Vendas continua do dono; estoque e
 * campanhas passam a ser do gerente também, que é quem toca isso numa casa de
 * verdade.
 *
 * Uma função só, e não `can()` espalhado por três arquivos: a barra lateral, o
 * portão do layout e o redirecionamento da raiz têm que concordar. Discordando,
 * o resultado é um item de menu que leva a 403.
 */
export const SECOES_DA_GESTAO = [
  { href: '/app/gestao',                acao: 'dashboard.view' },
  { href: '/app/gestao/operacao',       acao: 'dashboard.view' },
  { href: '/app/gestao/cardapio',       acao: 'dashboard.view' },
  { href: '/app/gestao/promocoes',      acao: 'dashboard.view' },
  { href: '/app/gestao/mesas',          acao: 'dashboard.view' },
  { href: '/app/gestao/equipe',         acao: 'staff.manage' },
  { href: '/app/gestao/clientes',       acao: 'dashboard.view' },
  { href: '/app/gestao/estoque',        acao: 'stock.manage' },
  { href: '/app/gestao/campanhas',      acao: 'campaign.manage' },
  { href: '/app/gestao/auditoria',      acao: 'audit.view' },
  { href: '/app/gestao/configuracoes',  acao: 'restaurant.settings' },
] as const satisfies readonly { href: string; acao: Action }[];

/** As seções que ESTA pessoa abre, na ordem da barra lateral. */
export function secoesVisiveis(session: Actor | null | undefined): string[] {
  return SECOES_DA_GESTAO.filter((s) => can(session, s.acao)).map((s) => s.href);
}

/** Entra no console quem abre pelo menos uma seção. */
export function podeAbrirGestao(session: Actor | null | undefined): boolean {
  return SECOES_DA_GESTAO.some((s) => can(session, s.acao));
}
