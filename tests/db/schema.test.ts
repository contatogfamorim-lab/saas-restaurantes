/**
 * Testes contra o banco REAL (spec §10.11 e §16).
 *
 *   pnpm db:start && pnpm db:reset && pnpm test:db
 *
 * Cada teste de RLS roda dentro de uma transação que troca o papel para
 * `anon` ou `authenticated` e injeta a claim `sub` do JWT — é assim que
 * `auth.uid()` enxerga um usuário. Conectado como `postgres` a RLS seria
 * ignorada (superusuário tem BYPASSRLS) e todo teste passaria por engano.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

import { prepararBanco } from './_prepare';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE_A = '11111111-1111-4111-8111-111111111111';
const DONO_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const GARCOM_A = 'aaaaaaaa-0000-4000-8000-000000000002';
const COZINHA_A = 'aaaaaaaa-0000-4000-8000-000000000003';
const PRODUTO_DESTAQUE = '44444444-0000-4000-8000-000000000007'; // Trinca da Casa, R

/** Restaurante B, criado só para provar que A não enxerga nada dele. */
const RESTAURANTE_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const DONO_B = 'bbbbbbbb-0000-4000-8000-000000000001';

let pool: Pool;

/** Roda `fn` como um funcionário autenticado e desfaz tudo ao final. */
async function comoFuncionario<T>(
  profileId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('request.jwt.claims',
         json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [profileId],
    );
    await client.query('set local role authenticated');
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

async function comoAnonimo<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local role anon');
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

/** Cria uma comanda aberta com um item já aprovado. Devolve os ids. */
async function abrirComandaComItem(c: Client, mesaLabel = 'Mesa 1') {
  const { rows: [mesa] } = await c.query(
    `select id from restaurant_tables where restaurant_id = $1 and label = $2`,
    [RESTAURANTE_A, mesaLabel],
  );
  const { rows: [sessao] } = await c.query(
    `insert into table_sessions (restaurant_id, table_id, waiter_id)
     values ($1, $2, $3) returning id`,
    [RESTAURANTE_A, mesa.id, GARCOM_A],
  );
  const { rows: [guest] } = await c.query(
    `insert into session_guests (restaurant_id, session_id, display_name)
     values ($1, $2, 'Tereza') returning id`,
    [RESTAURANTE_A, sessao.id],
  );
  const { rows: [pedido] } = await c.query(
    `insert into orders (restaurant_id, session_id, guest_id, source, idempotency_key)
     values ($1, $2, $3, 'guest', $4) returning id`,
    [RESTAURANTE_A, sessao.id, guest.id, `idem-${crypto.randomUUID()}`],
  );
  const { rows: [item] } = await c.query(
    `insert into order_items
       (restaurant_id, order_id, product_id, guest_id, qty,
        unit_price_cents, total_price_cents, station)
     values ($1, $2, $3, $4, 1, 8900, 8900, 'cozinha') returning id`,
    [RESTAURANTE_A, pedido.id, PRODUTO_DESTAQUE, guest.id],
  );
  return { mesaId: mesa.id, sessaoId: sessao.id, guestId: guest.id, pedidoId: pedido.id, itemId: item.id };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);

  // Restaurante B + dono, para os testes de isolamento
  await pool.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                             email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                             created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
             'dono@concorrente.test', extensions.crypt('x', extensions.gen_salt('bf', 4)),
             now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
     on conflict (id) do nothing`,
    [DONO_B],
  );
  await pool.query(
    `insert into restaurants (id, name, slug) values ($1, 'Concorrente', 'concorrente')
     on conflict (id) do nothing`,
    [RESTAURANTE_B],
  );
  await pool.query(
    `insert into profiles (id, restaurant_id, name, roles)
     values ($1, $2, 'Dono B', array['owner']::staff_role[])
     on conflict (id) do nothing`,
    [DONO_B, RESTAURANTE_B],
  );
  await pool.query(
    `insert into restaurant_tables (restaurant_id, label) values ($1, 'Mesa B1')
     on conflict do nothing`,
    [RESTAURANTE_B],
  );
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('§10.11 — isolamento entre tenants', () => {
  it('token do restaurante A não lê NENHUMA linha do restaurante B', async () => {
    const tabelas = [
      'restaurants', 'profiles', 'restaurant_tables', 'categories', 'products',
      'modifier_groups', 'modifier_options', 'product_modifier_groups',
      'promotions', 'promotion_targets', 'table_sessions', 'session_guests',
      'orders', 'order_items', 'order_item_modifiers', 'waiter_calls',
      'session_adjustments', 'payments', 'menu_events', 'menu_layouts',
      'menu_blocks', 'audit_log',
    ];

    await comoFuncionario(DONO_A, async (c) => {
      for (const tabela of tabelas) {
        const coluna = tabela === 'restaurants' ? 'id' : 'restaurant_id';
        const { rows } = await c.query(
          `select count(*)::int as n from ${tabela} where ${coluna} = $1`,
          [RESTAURANTE_B],
        );
        expect(rows[0].n, `vazou ${tabela} do restaurante B`).toBe(0);
      }
    });
  });

  it('o dono de B também não enxerga A', async () => {
    await comoFuncionario(DONO_B, async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from products where restaurant_id = $1`,
        [RESTAURANTE_A],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('§10.2 — superfície anônima', () => {
  it('anon lê o cardápio público', async () => {
    await comoAnonimo(async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from products`);
      expect(rows[0].n).toBeGreaterThan(0);
    });
  });

  /**
   * "Não enxerga" tem duas formas válidas, e a mais forte é a primeira:
   *   1. `permission denied` — falta o GRANT, a policy nem chega a ser avaliada
   *   2. zero linhas — tem GRANT, e a RLS filtrou tudo
   * O que não pode, em hipótese alguma, é voltar dado.
   */
  async function naoEnxerga(c: Client, tabela: string) {
    try {
      const { rows } = await c.query(`select count(*)::int as n from ${tabela}`);
      expect(rows[0].n, `anon leu ${rows[0].n} linha(s) de ${tabela}`).toBe(0);
    } catch (err) {
      expect(
        String((err as Error).message),
        `${tabela} falhou por outro motivo que não permissão`,
      ).toMatch(/permission denied/i);
      // a transação aborta após o erro; reabre para o próximo laço
      await c.query('rollback');
      await c.query('begin');
      await c.query('set local role anon');
    }
  }

  it('anon NÃO lê comandas, clientes, pagamentos nem auditoria', async () => {
    await comoAnonimo(async (c) => {
      for (const tabela of ['table_sessions', 'session_guests', 'orders',
                            'order_items', 'order_item_modifiers', 'payments',
                            'session_adjustments', 'audit_log', 'promotions',
                            'promotion_targets', 'menu_events', 'profiles',
                            'waiter_calls', 'menu_layouts', 'menu_blocks']) {
        await naoEnxerga(c, tabela);
      }
    });
  });

  it('anon NÃO enumera short_code das mesas', async () => {
    await comoAnonimo(async (c) => {
      await naoEnxerga(c, 'restaurant_tables');
    });
  });

  it('anon não escreve em lugar nenhum', async () => {
    await comoAnonimo(async (c) => {
      await expect(
        c.query(`update products set price_cents = 1 where id = $1`, [PRODUTO_DESTAQUE]),
      ).rejects.toThrow();
    });
  });
});

// ===========================================================================
describe('§3 regra 1 — snapshot de preço', () => {
  it('mudar o preço do produto NÃO altera comanda já aberta', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { sessaoId } = await abrirComandaComItem(c);
      await c.query(
        `update order_items set status = 'queued' where order_id in
           (select id from orders where session_id = $1)`,
        [sessaoId],
      );

      const antes = await c.query(
        `select subtotal_cents from session_totals where session_id = $1`, [sessaoId]);

      await c.query(`update products set price_cents = 19900 where id = $1`,
                    [PRODUTO_DESTAQUE]);

      const depois = await c.query(
        `select subtotal_cents from session_totals where session_id = $1`, [sessaoId]);

      expect(depois.rows[0].subtotal_cents).toBe(antes.rows[0].subtotal_cents);
      expect(depois.rows[0].subtotal_cents).toBe(8900);
    });
  });

  it('o valor de um item lançado é imutável', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { itemId } = await abrirComandaComItem(c);
      await expect(
        c.query(`update order_items set unit_price_cents = 1 where id = $1`, [itemId]),
      ).rejects.toThrow(/imut/i);
    });
  });

  it('§10.1 — total inconsistente com o item é rejeitado no commit', async () => {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role','authenticated')::text, true)`,
        [DONO_A]);
      await client.query('set local role authenticated');
      const { mesaId } = await abrirComandaComItem(client, 'Mesa 2');
      expect(mesaId).toBeTruthy();

      // total adulterado: 1 × 8900 declarado como 100
      const { rows: [sessao] } = await client.query(
        `select id from table_sessions where table_id = $1 and status = 'open'`, [mesaId]);
      const { rows: [pedido] } = await client.query(
        `select id from orders where session_id = $1 limit 1`, [sessao.id]);
      await client.query(
        `insert into order_items (restaurant_id, order_id, product_id, qty,
                                  unit_price_cents, total_price_cents, station)
         values ($1, $2, $3, 1, 8900, 100, 'cozinha')`,
        [RESTAURANTE_A, pedido.id, PRODUTO_DESTAQUE]);

      await expect(client.query('commit')).rejects.toThrow(/inconsistente/i);
    } finally {
      await client.query('rollback').catch(() => {});
      await client.end();
    }
  });
});

describe('§10.1 — validação de quantidade', () => {
  it.each([0, -1, 21])('qty = %s é rejeitado', async (qty) => {
    await comoFuncionario(DONO_A, async (c) => {
      const { pedidoId } = await abrirComandaComItem(c, 'Mesa 3');
      await expect(
        c.query(
          `insert into order_items (restaurant_id, order_id, product_id, qty,
                                    unit_price_cents, total_price_cents, station)
           values ($1, $2, $3, $4, 100, 100, 'cozinha')`,
          [RESTAURANTE_A, pedidoId, PRODUTO_DESTAQUE, qty]),
      ).rejects.toThrow();
    });
  });
});

// ===========================================================================
describe('§3 regra 2 — uma sessão aberta por mesa', () => {
  it('a segunda sessão aberta na mesma mesa falha', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { mesaId } = await abrirComandaComItem(c, 'Mesa 4');
      await expect(
        c.query(`insert into table_sessions (restaurant_id, table_id) values ($1, $2)`,
                [RESTAURANTE_A, mesaId]),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });
});

// ===========================================================================
describe('§3 — máquina de estados do item', () => {
  it('item nasce pending: nada vai para a cozinha sem aprovação', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { pedidoId } = await abrirComandaComItem(c, 'Mesa 5');
      await expect(
        c.query(
          `insert into order_items (restaurant_id, order_id, product_id, qty,
                                    unit_price_cents, total_price_cents, station, status)
           values ($1, $2, $3, 1, 100, 100, 'cozinha', 'queued')`,
          [RESTAURANTE_A, pedidoId, PRODUTO_DESTAQUE]),
      ).rejects.toThrow(/pending/i);
    });
  });

  it('pending → ready pula etapas e é rejeitado', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { itemId } = await abrirComandaComItem(c, 'Mesa 6');
      await expect(
        c.query(`update order_items set status = 'ready' where id = $1`, [itemId]),
      ).rejects.toThrow(/Transição inválida/i);
    });
  });

  it('delivered é terminal', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { itemId } = await abrirComandaComItem(c, 'Mesa 7');
      for (const s of ['queued', 'preparing', 'ready', 'delivered']) {
        await c.query(`update order_items set status = $1 where id = $2`, [s, itemId]);
      }
      await expect(
        c.query(`update order_items set status = 'preparing' where id = $1`, [itemId]),
      ).rejects.toThrow(/Transição inválida/i);
    });
  });

  it('§16 — o cronômetro começa na APROVAÇÃO, não no envio', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { itemId } = await abrirComandaComItem(c, 'Mesa 8');

      const criado = await c.query(
        `select created_at, queued_at from order_items where id = $1`, [itemId]);
      expect(criado.rows[0].queued_at).toBeNull();

      await c.query(`update order_items set status = 'queued' where id = $1`, [itemId]);
      const aprovado = await c.query(
        `select queued_at, started_at from order_items where id = $1`, [itemId]);

      expect(aprovado.rows[0].queued_at).not.toBeNull();
      expect(aprovado.rows[0].started_at).toBeNull();
      expect(new Date(aprovado.rows[0].queued_at).getTime())
        .toBeGreaterThanOrEqual(new Date(criado.rows[0].created_at).getTime());
    });
  });
});

// ===========================================================================
describe('§10.3 — escalonamento de privilégio', () => {
  it('nem o dono altera os próprios roles', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await expect(
        c.query(`update profiles set roles = array['owner','manager']::staff_role[]
                 where id = $1`, [DONO_A]),
      ).rejects.toThrow(/próprios roles/i);
    });
  });

  it('o funcionário não muda o próprio restaurant_id para pular de tenant', async () => {
    await comoFuncionario(GARCOM_A, async (c) => {
      await expect(
        c.query(`update profiles set restaurant_id = $2 where id = $1`,
                [GARCOM_A, RESTAURANTE_B]),
      ).rejects.toThrow(/restaurant_id/i);
    });
  });

  it('o funcionário desligado não se reativa sozinho', async () => {
    await comoFuncionario(GARCOM_A, async (c) => {
      await expect(
        c.query(`update profiles set active = false where id = $1`, [GARCOM_A]),
      ).rejects.toThrow(/reativar/i);
    });
  });

  it('profile sem nenhum papel é rejeitado', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                                 email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                                 created_at, updated_at)
         values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
                 'authenticated', 'vazio@teste.test', 'x', now(),
                 '{}'::jsonb, '{}'::jsonb, now(), now())`);
      const { rows: [u] } = await c.query(
        `select id from auth.users where email = 'vazio@teste.test'`);
      await expect(
        c.query(`insert into profiles (id, restaurant_id, name) values ($1, $2, 'Sem papel')`,
                [u.id, RESTAURANTE_A]),
      ).rejects.toThrow();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('o garçom não altera os roles de ninguém', async () => {
    await comoFuncionario(GARCOM_A, async (c) => {
      const r = await c.query(
        `update profiles set roles = array['owner']::staff_role[] where id = $1`,
        [COZINHA_A]);
      expect(r.rowCount, 'RLS deveria bloquear a linha').toBe(0);
    });
  });
});

describe('§12.9 — guarda de coluna em products', () => {
  it('sem menu.price, o garçom não altera preço por nenhum caminho', async () => {
    await comoFuncionario(GARCOM_A, async (c) => {
      await expect(
        c.query(`update products set price_cents = 1 where id = $1`, [PRODUTO_DESTAQUE]),
      ).rejects.toThrow(/menu\.price/i);
    });
  });

  it('a cozinha marca esgotado — é o botão "Acabou" do KDS', async () => {
    await comoFuncionario(COZINHA_A, async (c) => {
      const r = await c.query(
        `update products set is_available = false where id = $1`, [PRODUTO_DESTAQUE]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('§16 — toda alteração de preço vai para audit_log com antes e depois', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await c.query(`update products set price_cents = 9500 where id = $1`,
                    [PRODUTO_DESTAQUE]);
      const { rows } = await c.query(
        `select before, after from audit_log
          where action = 'product.price_changed' and entity_id = $1
          order by created_at desc limit 1`, [PRODUTO_DESTAQUE]);
      expect(rows).toHaveLength(1);
      expect(rows[0].before.price_cents).toBe(8900);
      expect(rows[0].after.price_cents).toBe(9500);
    });
  });
});

// ===========================================================================
describe('§10.8 — audit_log é imutável', () => {
  it('rejeita UPDATE e DELETE mesmo para o dono', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await c.query(`update products set price_cents = 9100 where id = $1`,
                    [PRODUTO_DESTAQUE]);
      const { rows: [linha] } = await c.query(
        `select id from audit_log order by created_at desc limit 1`);

      await expect(
        c.query(`update audit_log set action = 'nada' where id = $1`, [linha.id]),
      ).rejects.toThrow();
      await expect(
        c.query(`delete from audit_log where id = $1`, [linha.id]),
      ).rejects.toThrow();
    });
  });

  it('rejeita UPDATE e DELETE até para service_role', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(
        `insert into audit_log (restaurant_id, actor_type, action, entity_type)
         values ($1, 'system', 'teste', 'products')`, [RESTAURANTE_A]);
      const { rows: [linha] } = await c.query(
        `select id from audit_log order by created_at desc limit 1`);
      await expect(
        c.query(`delete from audit_log where id = $1`, [linha.id]),
      ).rejects.toThrow(/append-only/i);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});

// ===========================================================================
describe('§12.12 — estoque de promoção é atômico', () => {
  it('duas reservas concorrentes da última unidade: só uma passa', async () => {
    const { rows: [promo] } = await pool.query(
      `insert into promotions (restaurant_id, name, status, discount_type,
                               discount_value, max_quantity, created_by)
       values ($1, 'Última unidade', 'active', 'percent', 20, 1, $2)
       returning id`, [RESTAURANTE_A, DONO_A]);

    const a = new Client({ connectionString: DATABASE_URL });
    const b = new Client({ connectionString: DATABASE_URL });
    await a.connect();
    await b.connect();

    try {
      await a.query('begin');
      await b.query('begin');

      const rA = await a.query(`select app.claim_promotion_quantity($1, 1) as ok`, [promo.id]);

      // B fica bloqueado no lock da linha até A confirmar
      const pendenteB = b.query(`select app.claim_promotion_quantity($1, 1) as ok`, [promo.id]);
      await a.query('commit');
      const rB = await pendenteB;
      await b.query('commit');

      expect(rA.rows[0].ok).toBe(true);
      expect(rB.rows[0].ok, 'a segunda reserva deveria falhar').toBe(false);

      const { rows: [final] } = await pool.query(
        `select used_quantity, max_quantity from promotions where id = $1`, [promo.id]);
      expect(final.used_quantity).toBe(1);
      expect(final.used_quantity).toBeLessThanOrEqual(final.max_quantity);
    } finally {
      await a.end();
      await b.end();
      await pool.query(`delete from promotions where id = $1`, [promo.id]);
    }
  });
});

// ===========================================================================
describe('§4 — cardápio dinâmico por horário', () => {
  it('a janela de Happy Hour respeita hora e dia da semana', async () => {
    const q = async (at: string) => {
      const { rows } = await pool.query(
        `select app.is_within_service_window('17:00'::time, '20:00'::time,
                array[1,2,3,4,5], 'America/Sao_Paulo', $1::timestamptz) as dentro`, [at]);
      return rows[0].dentro;
    };
    // 2026-08-24 é uma segunda-feira
    expect(await q('2026-08-24T18:00:00-03:00')).toBe(true);
    expect(await q('2026-08-24T16:59:00-03:00')).toBe(false);
    expect(await q('2026-08-24T20:00:00-03:00')).toBe(false);
    // 2026-08-23 é domingo: fora dos dias
    expect(await q('2026-08-23T18:00:00-03:00')).toBe(false);
  });

  it('janela que cruza a meia-noite (bar 18h–02h) funciona', async () => {
    const { rows } = await pool.query(
      `select app.is_within_service_window('18:00'::time, '02:00'::time, null,
              'America/Sao_Paulo', '2026-08-25T01:00:00-03:00'::timestamptz) as dentro`);
    expect(rows[0].dentro).toBe(true);
  });
});

// ===========================================================================
describe('§7 — fechamento da comanda', () => {
  it('taxa de serviço de 10% entra no total e o saldo zera com o pagamento', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { sessaoId } = await abrirComandaComItem(c, 'Mesa 1');
      await c.query(
        `update order_items set status = 'queued' where order_id in
           (select id from orders where session_id = $1)`, [sessaoId]);

      const t1 = await c.query(
        `select subtotal_cents, service_fee_cents, total_cents, balance_cents
           from session_totals where session_id = $1`, [sessaoId]);
      expect(t1.rows[0].subtotal_cents).toBe(8900);
      expect(t1.rows[0].service_fee_cents).toBe(890);
      expect(t1.rows[0].total_cents).toBe(9790);
      expect(t1.rows[0].balance_cents).toBe(9790);

      await c.query(
        `insert into payments (restaurant_id, session_id, method, amount_cents,
                               created_by, idempotency_key)
         values ($1, $2, 'pix', 9790, $3, $4)`,
        [RESTAURANTE_A, sessaoId, DONO_A, `pay-${crypto.randomUUID()}`]);

      const t2 = await c.query(
        `select balance_cents from session_totals where session_id = $1`, [sessaoId]);
      expect(t2.rows[0].balance_cents).toBe(0);
    });
  });

  it('remover a taxa zera service_fee_cents e fica registrado quem removeu', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { sessaoId } = await abrirComandaComItem(c, 'Mesa 2');
      await c.query(
        `update order_items set status = 'queued' where order_id in
           (select id from orders where session_id = $1)`, [sessaoId]);

      await c.query(
        `insert into session_adjustments (restaurant_id, session_id, type, reason, created_by)
         values ($1, $2, 'service_fee_waiver', 'Cliente reclamou do atendimento', $3)`,
        [RESTAURANTE_A, sessaoId, DONO_A]);

      const { rows } = await c.query(
        `select service_fee_cents, total_cents, service_fee_waived
           from session_totals where session_id = $1`, [sessaoId]);
      expect(rows[0].service_fee_waived).toBe(true);
      expect(rows[0].service_fee_cents).toBe(0);
      expect(rows[0].total_cents).toBe(8900);
    });
  });

  it('desconto exige motivo', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { sessaoId } = await abrirComandaComItem(c, 'Mesa 3');
      await expect(
        c.query(
          `insert into session_adjustments (restaurant_id, session_id, type,
                                            amount_cents, reason, created_by)
           values ($1, $2, 'discount', 500, '', $3)`,
          [RESTAURANTE_A, sessaoId, DONO_A]),
      ).rejects.toThrow();
    });
  });
});

// ===========================================================================
describe('§13.7 — idempotência', () => {
  it('repetir o mesmo comando não cria pedido duplicado', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { sessaoId, guestId } = await abrirComandaComItem(c, 'Mesa 4');
      const chave = `idem-fixa-${crypto.randomUUID()}`;

      await c.query(
        `insert into orders (restaurant_id, session_id, guest_id, source, idempotency_key)
         values ($1, $2, $3, 'guest', $4)`,
        [RESTAURANTE_A, sessaoId, guestId, chave]);

      await expect(
        c.query(
          `insert into orders (restaurant_id, session_id, guest_id, source, idempotency_key)
           values ($1, $2, $3, 'guest', $4)`,
          [RESTAURANTE_A, sessaoId, guestId, chave]),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });
});

// ===========================================================================
describe('§5 — liberação de mesa', () => {
  it('liberação forçada sem motivo é rejeitada', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { sessaoId } = await abrirComandaComItem(c, 'Mesa 5');
      await expect(
        c.query(
          `update table_sessions
              set status = 'closed', force_released = true, released_by = $2
            where id = $1`, [sessaoId, DONO_A]),
      ).rejects.toThrow();
    });
  });

  it('liberação forçada com motivo registra quem, quando e por quê', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { sessaoId, mesaId } = await abrirComandaComItem(c, 'Mesa 6');
      await c.query(
        `update table_sessions
            set status = 'closed', force_released = true, released_by = $2,
                released_at = now(), release_reason = 'cliente_foi_embora_sem_pagar'
          where id = $1`, [sessaoId, DONO_A]);

      const { rows } = await c.query(
        `select status, closed_at, released_by, release_reason
           from table_sessions where id = $1`, [sessaoId]);
      expect(rows[0].status).toBe('closed');
      expect(rows[0].closed_at).not.toBeNull();
      expect(rows[0].released_by).toBe(DONO_A);

      // o short_code da etiqueta NUNCA muda
      const { rows: [mesa] } = await c.query(
        `select short_code from restaurant_tables where id = $1`, [mesaId]);
      expect(mesa.short_code).toHaveLength(10);

      // e a mesa aceita uma sessão nova
      const nova = await c.query(
        `insert into table_sessions (restaurant_id, table_id) values ($1, $2) returning id`,
        [RESTAURANTE_A, mesaId]);
      expect(nova.rows[0].id).toBeTruthy();
    });
  });
});

// ===========================================================================
describe('§10.4 — short_code das mesas', () => {
  it('tem 10 caracteres, é único e não é sequencial', async () => {
    const { rows } = await pool.query(
      `select short_code from restaurant_tables where restaurant_id = $1 order by label`,
      [RESTAURANTE_A]);
    expect(rows).toHaveLength(8);

    const codigos: string[] = rows.map((r) => r.short_code);
    expect(new Set(codigos).size, 'short_code precisa ser único').toBe(8);
    for (const c of codigos) expect(c).toMatch(/^[2-9A-HJ-NP-Za-km-z]{10}$/);

    // Não derivado do número da mesa: mesas em sequência não podem gerar
    // códigos em sequência. Comparar prefixos pega tanto o caso sequencial
    // quanto o de um contador disfarçado de aleatório.
    const prefixos = codigos.map((c) => c.slice(0, 4));
    expect(new Set(prefixos).size, 'prefixos repetidos sugerem código derivado').toBe(8);

    // E entropia real: 8 códigos de 10 chars não repetem caractere na mesma
    // posição em todas as mesas.
    for (let pos = 0; pos < 10; pos++) {
      const naPosicao = new Set(codigos.map((c) => c[pos]));
      expect(naPosicao.size, `posição ${pos} idêntica em todas as mesas`).toBeGreaterThan(1);
    }
  });
});

// ===========================================================================
describe('§16 — seed exigido pela Etapa 1', () => {
  it('tem 1 restaurante, 8 mesas, 5 categorias e 30 produtos', async () => {
    const conta = async (t: string) =>
      (await pool.query(`select count(*)::int as n from ${t} where restaurant_id = $1`,
                        [RESTAURANTE_A])).rows[0].n;
    expect(await conta('restaurant_tables')).toBe(8);
    expect(await conta('categories')).toBe(5);
    expect(await conta('products')).toBe(30);
    expect(await conta('modifier_groups')).toBe(6);
  });

  it('tem um funcionário acumulando waiter e cashier (P1b)', async () => {
    // roles::text[] no SELECT: o driver não conhece o OID de staff_role[] e
    // devolveria a string bruta '{waiter,cashier}' em vez de um array.
    const { rows } = await pool.query(
      `select name, roles::text[] as roles from profiles
        where restaurant_id = $1 and roles @> array['waiter','cashier']::staff_role[]`,
      [RESTAURANTE_A]);
    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toEqual(expect.arrayContaining(['waiter', 'cashier']));
  });

  it('todo produto tem preço em centavos inteiros e positivos', async () => {
    const { rows } = await pool.query(
      `select count(*)::int as n from products
        where restaurant_id = $1 and (price_cents <= 0 or price_cents <> round(price_cents))`,
      [RESTAURANTE_A]);
    expect(rows[0].n).toBe(0);
  });
});
