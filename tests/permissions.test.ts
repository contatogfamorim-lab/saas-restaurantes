import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  DELEGATABLE_PERMISSIONS,
  DISCOUNT_CEILING_PCT,
  PERMISSION_MATRIX,
  ROLES,
  type Actor,
  type Role,
  can,
  canApplyDiscount,
  canEditStaffRoles,
  canMarkOutOfStock,
  canOpenMenuEditor,
  menuPermissions,
  canReleaseTable,
  isSameTenant,
  maskPhone,
} from '@/lib/permissions';

const RESTAURANT = 'r-1';

function actor(roles: Role[], permissions: string[] = [], id = 'u-1'): Actor {
  return { id, restaurantId: RESTAURANT, roles, permissions, active: true };
}

const owner = actor(['owner'], [], 'u-owner');
const manager = actor(['manager'], [], 'u-manager');
const waiter = actor(['waiter'], [], 'u-waiter');
const kitchen = actor(['kitchen'], [], 'u-kitchen');
const cashier = actor(['cashier'], [], 'u-cashier');
/** P1b: em casa pequena a mesma pessoa é caixa E garçom. */
const waiterCashier = actor(['waiter', 'cashier'], [], 'u-duplo');

describe('matriz de permissão (spec §10.3)', () => {
  it('cobre todas as ações declaradas', () => {
    for (const action of ACTIONS) {
      expect(PERMISSION_MATRIX[action], `ação sem entrada: ${action}`).toBeDefined();
    }
  });

  it('só declara papéis válidos', () => {
    for (const [action, roles] of Object.entries(PERMISSION_MATRIX)) {
      for (const role of roles) {
        expect(ROLES, `papel inválido em ${action}: ${role}`).toContain(role);
      }
    }
  });

  it.each([
    ['order.approve', [waiter, manager, owner], [cashier, kitchen]],
    ['product.mark_out_of_stock', [waiter, manager, owner, kitchen], [cashier]],
    ['payment.record', [cashier, manager, owner], [waiter, kitchen]],
    ['service_fee.remove', [cashier, manager, owner], [waiter, kitchen]],
    ['table.release', [waiter, cashier, manager, owner], [kitchen]],
    ['table.force_release', [manager, owner], [waiter, cashier, kitchen]],
    ['dashboard.view', [owner], [manager, waiter, cashier, kitchen]],
    ['customer.view_full_phone', [manager, owner], [waiter, cashier, kitchen]],
    ['customer.export', [owner], [manager, waiter, cashier, kitchen]],
    ['staff.manage', [owner], [manager, waiter, cashier, kitchen]],
  ] as const)('%s', (action, allowed, denied) => {
    for (const a of allowed) expect(can(a, action), `${a.id} deveria poder`).toBe(true);
    for (const d of denied) expect(can(d, action), `${d.id} NÃO deveria poder`).toBe(false);
  });
});

describe('acúmulo de funções (spec P1b)', () => {
  it('waiter+cashier acessa as duas telas com um cadastro só', () => {
    expect(can(waiterCashier, 'order.approve')).toBe(true);   // tela do garçom
    expect(can(waiterCashier, 'payment.record')).toBe(true);  // tela do caixa
  });

  it('acumular funções não concede o que nenhuma das duas dá', () => {
    expect(can(waiterCashier, 'dashboard.view')).toBe(false);
    expect(can(waiterCashier, 'table.force_release')).toBe(false);
    expect(can(waiterCashier, 'menu.price')).toBe(false);
  });
});

/**
 * Uma tela por função.
 *
 * Espelha `telasVisiveis()` sem importá-la — aquele módulo é server-only. O que
 * está sendo travado aqui é a propriedade, não a implementação: ninguém ganha
 * tela por efeito colateral de uma permissão pontual.
 */
function telasDe(a: Actor) {
  return {
    salao: can(a, 'order.approve'),
    cozinha: can(a, 'kds.advance_item'),
    caixa: can(a, 'payment.record'),
    gestao: can(a, 'dashboard.view'),
  };
}

describe('cada função enxerga a própria tela', () => {
  it('garçom vê só o salão — não o KDS', () => {
    expect(telasDe(waiter)).toEqual({
      salao: true,
      cozinha: false,
      caixa: false,
      gestao: false,
    });
  });

  it('cozinha vê só o KDS', () => {
    expect(telasDe(kitchen)).toEqual({
      salao: false,
      cozinha: true,
      caixa: false,
      gestao: false,
    });
  });

  it('caixa vê só o caixa — não o mapa do salão', () => {
    expect(telasDe(cashier)).toEqual({
      salao: false,
      cozinha: false,
      caixa: true,
      gestao: false,
    });
  });

  it('quem acumula funções vê exatamente as duas que acumula (P1b)', () => {
    expect(telasDe(waiterCashier)).toEqual({
      salao: true,
      cozinha: false,
      caixa: true,
      gestao: false,
    });
  });

  it('quem administra enxerga tudo — é a única visão panorâmica', () => {
    expect(telasDe(owner)).toEqual({
      salao: true,
      cozinha: true,
      caixa: true,
      gestao: true,
    });
  });

  it('gerente supervisiona a operação, mas gestão é só de quem administra', () => {
    expect(telasDe(manager)).toEqual({
      salao: true,
      cozinha: true,
      caixa: true,
      gestao: false,
    });
  });
});

describe('teto de desconto', () => {
  it('caixa vai até 10% e para aí', () => {
    expect(canApplyDiscount(cashier, 5)).toBe(true);
    expect(canApplyDiscount(cashier, 10)).toBe(true);
    expect(canApplyDiscount(cashier, 10.01)).toBe(false);
    expect(canApplyDiscount(cashier, 30)).toBe(false);
  });

  it('gerente e dono passam do teto do caixa', () => {
    expect(canApplyDiscount(manager, 30)).toBe(true);
    expect(canApplyDiscount(owner, 100)).toBe(true);
  });

  it('garçom não dá desconto nenhum', () => {
    expect(canApplyDiscount(waiter, 1)).toBe(false);
  });

  it('rejeita percentual absurdo, negativo, zero ou NaN', () => {
    for (const pct of [0, -5, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(canApplyDiscount(owner, pct), `pct=${pct}`).toBe(false);
    }
  });

  it('quem acumula funções usa o maior teto entre elas', () => {
    const managerCashier = actor(['cashier', 'manager'], [], 'u-mc');
    expect(canApplyDiscount(managerCashier, 40)).toBe(true);
    expect(DISCOUNT_CEILING_PCT.cashier).toBe(10);
  });
});

describe('liberar mesa (spec §5)', () => {
  it('saldo zerado: garçom e caixa liberam', () => {
    expect(canReleaseTable(waiter, 0)).toBe(true);
    expect(canReleaseTable(cashier, 0)).toBe(true);
  });

  it('saldo em aberto vira liberação forçada — garçom comum não consegue', () => {
    expect(canReleaseTable(waiter, 4500)).toBe(false);
    expect(canReleaseTable(cashier, 4500)).toBe(false);
    expect(canReleaseTable(waiterCashier, 4500)).toBe(false);
  });

  it('gerente e dono forçam', () => {
    expect(canReleaseTable(manager, 4500)).toBe(true);
    expect(canReleaseTable(owner, 4500)).toBe(true);
  });
});

describe('escalonamento de privilégio', () => {
  it('ninguém altera os próprios roles — nem o owner', () => {
    expect(canEditStaffRoles(owner, owner.id)).toBe(false);
    expect(canEditStaffRoles(manager, manager.id)).toBe(false);
  });

  it('o dono altera os roles dos outros', () => {
    expect(canEditStaffRoles(owner, waiter.id)).toBe(true);
  });

  it('gerente não mexe em equipe', () => {
    expect(canEditStaffRoles(manager, waiter.id)).toBe(false);
  });
});

describe('permissões delegadas do cardápio (spec §12.9)', () => {
  it('sem menu.price, o garçom não altera preço', () => {
    expect(can(waiter, 'menu.price')).toBe(false);
  });

  it('o dono delega menu.price pessoa a pessoa', () => {
    const managerComPreco = actor(['manager'], ['menu.price'], 'u-mp');
    expect(can(managerComPreco, 'menu.price')).toBe(true);
  });

  it('delegação não vale para ação não delegável', () => {
    const espertinho = actor(['waiter'], ['dashboard.view'], 'u-x');
    expect(can(espertinho, 'dashboard.view')).toBe(false);
  });

  it('cozinha marca esgotado por padrão — é o botão "Acabou" do KDS', () => {
    expect(can(kitchen, 'menu.availability')).toBe(true);
  });
});

describe('escopo de tenant', () => {
  it('restaurante diferente é sempre negado', () => {
    expect(isSameTenant(owner, RESTAURANT)).toBe(true);
    expect(isSameTenant(owner, 'r-2')).toBe(false);
  });
});

describe('funcionário inativo', () => {
  it('perde tudo, sem depender de revogar sessão', () => {
    const desligado: Actor = { ...owner, active: false };
    for (const action of ACTIONS) {
      expect(can(desligado, action), action).toBe(false);
    }
  });
});

describe('ator ausente ou sem papel', () => {
  it('null, undefined e roles vazio nunca passam', () => {
    for (const action of ACTIONS) {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
      expect(can(actor([]), action)).toBe(false);
    }
  });
});

describe('mascaramento de telefone (LGPD, spec §10.9)', () => {
  it('deixa só os quatro últimos dígitos', () => {
    expect(maskPhone('+5511998887766')).toBe('•••••-7766');
    expect(maskPhone('11998887766')).toBe('•••••-7766');
  });

  it('trata ausência e valor curto sem vazar nada', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('')).toBeNull();
    expect(maskPhone('12')).toBe('••••');
  });
});

describe('duas telas de cardápio, e não uma (spec §12)', () => {
  it('o EDITOR é de quem edita: gerente e administrador', () => {
    expect(canOpenMenuEditor(actor(['manager']))).toBe(true);
    expect(canOpenMenuEditor(actor(['owner']))).toBe(true);
  });

  it('cozinha e garçom NÃO abrem o editor', () => {
    // `menu.availability` sozinha não abre. Quando abria, a cozinha via seis
    // campos com cadeado e um "Salvar" que não salvava nada — uma tela cujo
    // único uso era descobrir que você não pode.
    expect(canOpenMenuEditor(actor(['kitchen']))).toBe(false);
    expect(canOpenMenuEditor(actor(['waiter']))).toBe(false);
    expect(canOpenMenuEditor(actor(['cashier']))).toBe(false);
  });

  it('mas cozinha e garçom marcam "acabou"', () => {
    // O outro lado da separação, e o teste que impede alguém de "endurecer" o
    // cardápio a ponto de tirar da cozinha a tarefa que ela faz toda noite.
    expect(canMarkOutOfStock(actor(['kitchen']))).toBe(true);
    expect(canMarkOutOfStock(actor(['waiter']))).toBe(true);
    expect(canMarkOutOfStock(actor(['manager']))).toBe(true);
    expect(canMarkOutOfStock(actor(['owner']))).toBe(true);
  });

  it('o caixa não marca esgotado nem edita', () => {
    expect(canMarkOutOfStock(actor(['cashier']))).toBe(false);
    expect(canOpenMenuEditor(actor(['cashier']))).toBe(false);
  });

  it('delegar menu.price abre o editor para quem não é gerente', () => {
    // É por isso que a porta é PERMISSÃO e não papel: amarrar em
    // `roles.includes('owner')` mataria a delegação da §12.9.
    expect(canOpenMenuEditor(actor(['cashier'], ['menu.price']))).toBe(true);
  });

  it('delegar SÓ menu.availability não abre o editor', () => {
    expect(canOpenMenuEditor(actor(['cashier'], ['menu.availability']))).toBe(false);
    expect(canMarkOutOfStock(actor(['cashier'], ['menu.availability']))).toBe(true);
  });

  it('a cozinha só leva menu.availability, e nada mais', () => {
    expect(menuPermissions(actor(['kitchen']))).toEqual(['menu.availability']);
  });

  it('o dono leva as seis', () => {
    expect(menuPermissions(actor(['owner'])).sort()).toEqual(
      [...DELEGATABLE_PERMISSIONS].sort(),
    );
  });

  it('delegação SOMA à função, não substitui', () => {
    const gerenteComPreco = actor(['manager'], ['menu.price']);
    expect(menuPermissions(gerenteComPreco).sort()).toEqual(
      ['menu.availability', 'menu.content', 'menu.price', 'menu.promotion', 'menu.structure'].sort(),
    );
  });

  it('permissão inventada em `permissions` não vira nada', () => {
    // O banco recusa por CHECK constraint; aqui a garantia é que `can()` só
    // olha a lista de delegáveis, então lixo no array é inerte.
    const comLixo = actor(['kitchen'], ['staff.manage', 'dashboard.view', '*']);
    expect(can(comLixo, 'staff.manage')).toBe(false);
    expect(can(comLixo, 'dashboard.view')).toBe(false);
    expect(menuPermissions(comLixo)).toEqual(['menu.availability']);
  });

  it('funcionário desligado não entra nem com permissão delegada', () => {
    const desligado: Actor = {
      id: 'u-x',
      restaurantId: RESTAURANT,
      roles: ['manager'],
      permissions: ['menu.price'],
      active: false,
    };
    expect(canOpenMenuEditor(desligado)).toBe(false);
    expect(menuPermissions(desligado)).toEqual([]);
  });
});
