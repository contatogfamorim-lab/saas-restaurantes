/**
 * Ações do garçom (spec §5) — aprovação, marcha e liberação de mesa.
 *
 * As funções são SECURITY INVOKER, então cada teste roda COMO um funcionário
 * de verdade (papel `authenticated` + claim `sub`). Rodar como `postgres`
 * ignoraria a RLS e todos passariam por engano — que é o modo mais fácil de
 * escrever uma suíte inteira que não prova nada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

import { prepararBanco } from './_prepare';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE_A = '11111111-1111-4111-8111-111111111111';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000001';
const GARCOM = 'aaaaaaaa-0000-4000-8000-000000000002';
const COZINHA = 'aaaaaaaa-0000-4000-8000-000000000003';
const CAIXA = 'aaaaaaaa-0000-4000-8000-000000000004';

const AGUA = '44444444-0000-4000-8000-000000000023';
const REFRI = '44444444-0000-4000-8000-000000000024';
const PETIT_GATEAU = '44444444-0000-4000-8000-000000000020';

let pool: Pool;
let shortCode: string;

/** Roda como um funcionário autenticado, em transação desfeita ao final. */
async function como<T>(profileId: string, fn: (c: Client) => Promise<T>): Promise<T> {
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

/**
 * Espera que o comando falhe, sem matar a transação do teste.
 *
 * No Postgres, um erro aborta a transação inteira e todo comando seguinte é
 * recusado. Sem o SAVEPOINT, qualquer teste que verifica uma recusa e DEPOIS
 * confere o estado do banco morre no segundo passo — e a falha aponta para o
 * lugar errado.
 */
async function falhaCom(
  c: Client,
  regex: RegExp,
  sql: string,
  params: unknown[] = [],
) {
  await c.query('savepoint tentativa');
  let mensagem: string | null = null;
  try {
    await c.query(sql, params);
  } catch (err) {
    mensagem = (err as Error).message;
  }
  await c.query('rollback to savepoint tentativa');

  expect(mensagem, 'esperava falha, mas o comando passou').not.toBeNull();
  expect(mensagem!).toMatch(regex);
}

/**
 * Cria uma comanda com um pedido pendente.
 *
 * Precisa rodar como postgres porque `create_guest_order` é SECURITY DEFINER
 * com grant só para service_role — é assim que o cliente cria pedido, via
 * Route Handler. Depois disso o teste volta a ser o funcionário.
 */
async function comandaComPedido(
  c: Client,
  itens: { product_id: string; qty: number; course?: number }[],
) {
  await c.query('set local role postgres');

  const { rows: [s] } = await c.query(
    `select public.open_guest_session($1, 'Tereza', '', 'dev-teste', false) as r`,
    [shortCode],
  );
  const sessao = s.r as { session_id: string; guest_id: string };

  const { rows: [pedido] } = await c.query(
    `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
    [sessao.session_id, sessao.guest_id, `t-${crypto.randomUUID()}`,
     JSON.stringify(itens.map((i) => ({ product_id: i.product_id, qty: i.qty })))],
  );

  // cursos são decisão do garçom; o cliente não os envia
  for (const item of itens) {
    if (item.course) {
      await c.query(
        `update order_items set course = $1
          where order_id = $2 and product_id = $3`,
        [item.course, pedido.id, item.product_id],
      );
    }
  }

  // ordena por product_id na MESMA ordem em que os itens foram pedidos:
  // created_at empata dentro da transação e não serve de critério
  const { rows: linhas } = await c.query(
    `select id, course, product_id from order_items where order_id = $1`,
    [pedido.id],
  );
  linhas.sort(
    (a, b) =>
      itens.findIndex((i) => i.product_id === a.product_id) -
      itens.findIndex((i) => i.product_id === b.product_id),
  );

  await c.query('set local role authenticated');

  return { ...sessao, orderId: pedido.id as string, itens: linhas };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);
  const { rows } = await pool.query(
    `select short_code from restaurant_tables where restaurant_id = $1 order by label limit 1`,
    [RESTAURANTE_A],
  );
  shortCode = rows[0].short_code;
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('§16 — nada vai para a cozinha sem o garçom', () => {
  it('aprovar tudo move os itens para a fila e inicia o cronômetro', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);

      const antes = await c.query(
        `select status, queued_at from order_items where order_id = $1`, [p.orderId]);
      expect(antes.rows[0].status).toBe('pending');
      expect(antes.rows[0].queued_at).toBeNull();

      await c.query(`select public.approve_order($1, $2::uuid[])`,
        [p.orderId, p.itens.map((i) => i.id)]);

      const depois = await c.query(
        `select status, queued_at from order_items where order_id = $1`, [p.orderId]);
      expect(depois.rows[0].status).toBe('queued');
      // o cronômetro começa AQUI, na aprovação — não no envio do cliente
      expect(depois.rows[0].queued_at).not.toBeNull();

      const { rows: [o] } = await c.query(`select status from orders where id = $1`, [p.orderId]);
      expect(o.status).toBe('approved');
    });
  });

  it('a cozinha não aprova pedido', async () => {
    await como(COZINHA, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);
      await falhaCom(c, /Sem permissão/i,
        `select public.approve_order($1, $2::uuid[])`,
        [p.orderId, p.itens.map((i) => i.id)]);
    });
  });

  it('o caixa não aprova pedido', async () => {
    await como(CAIXA, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);
      await falhaCom(c, /Sem permissão/i,
        `select public.approve_order($1, $2::uuid[])`,
        [p.orderId, p.itens.map((i) => i.id)]);
    });
  });

  it('pedido já conferido não é aprovado de novo', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);
      await c.query(`select public.approve_order($1, $2::uuid[])`,
        [p.orderId, p.itens.map((i) => i.id)]);

      await falhaCom(c, /já foi conferido/i,
        `select public.approve_order($1, $2::uuid[])`,
        [p.orderId, p.itens.map((i) => i.id)]);
    });
  });
});

// ===========================================================================
describe('§5 — recusa de item', () => {
  it('aprovação parcial: um entra na fila, outro é recusado', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [
        { product_id: AGUA, qty: 1 },
        { product_id: REFRI, qty: 1 },
      ]);

      const { rows: [r] } = await c.query(
        `select public.approve_order($1, $2::uuid[], $3::jsonb) as r`,
        [p.orderId, [p.itens[0].id],
         JSON.stringify([{ item_id: p.itens[1].id, reason: 'cliente_desistiu' }])],
      );

      expect(r.r.aprovados).toBe(1);
      expect(r.r.recusados).toBe(1);
      expect(r.r.status).toBe('partially_approved');

      // Por ID, não por ordem: `now()` é fixo dentro da transação, então os
      // dois itens nascem com o mesmo created_at e a ordenação é indefinida.
      const porId = new Map(
        (
          await c.query(
            `select id, status, rejection_reason from order_items where order_id = $1`,
            [p.orderId],
          )
        ).rows.map((r) => [r.id, r]),
      );

      expect(porId.get(p.itens[0].id).status).toBe('queued');
      expect(porId.get(p.itens[1].id).status).toBe('cancelled');
      expect(porId.get(p.itens[1].id).rejection_reason).toBe('cliente_desistiu');
    });
  });

  it('recusa sem motivo é rejeitada', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);
      await falhaCom(c, /motivo/i,
        `select public.approve_order($1, $2::uuid[], $3::jsonb)`,
        [p.orderId, [], JSON.stringify([{ item_id: p.itens[0].id, reason: '' }])]);
    });
  });

  it('recusar por "acabou" marca out_of_stock, não cancelled', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);

      await c.query(`select public.approve_order($1, $2::uuid[], $3::jsonb)`,
        [p.orderId, [], JSON.stringify([{ item_id: p.itens[0].id, reason: 'acabou' }])]);

      const { rows } = await c.query(
        `select status from order_items where order_id = $1`, [p.orderId]);
      // a distinção alimenta o ranking de rupturas do dashboard (spec §8)
      expect(rows[0].status).toBe('out_of_stock');
    });
  });

  it('§16 — "acabou" com marcação some o produto do cardápio', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);

      await c.query(`select public.approve_order($1, $2::uuid[], $3::jsonb)`,
        [p.orderId, [],
         JSON.stringify([{ item_id: p.itens[0].id, reason: 'acabou',
                           mark_out_of_stock: true }])]);

      const { rows } = await c.query(
        `select is_available from products where id = $1`, [AGUA]);
      expect(rows[0].is_available).toBe(false);

      // e some da view que o cardápio público consulta
      const { rows: preco } = await c.query(
        `select 1 from product_effective_prices e join products p on p.id = e.product_id
          where e.product_id = $1 and p.is_available`, [AGUA]);
      expect(preco).toHaveLength(0);
    });
  });

  it('recusar tudo deixa o pedido como rejected', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);
      const { rows: [r] } = await c.query(
        `select public.approve_order($1, $2::uuid[], $3::jsonb) as r`,
        [p.orderId, [],
         JSON.stringify([{ item_id: p.itens[0].id, reason: 'erro_no_pedido' }])]);
      expect(r.r.status).toBe('rejected');
    });
  });
});

// ===========================================================================
describe('§5 — marcha (coursing)', () => {
  it('curso retido não vai para a cozinha e não inicia o cronômetro', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [
        { product_id: AGUA, qty: 1, course: 1 },
        { product_id: PETIT_GATEAU, qty: 1, course: 3 },
      ]);

      await c.query(`select public.approve_order($1, $2::uuid[], '[]'::jsonb, $3::int[])`,
        [p.orderId, p.itens.map((i) => i.id), [3]]);

      const { rows } = await c.query(
        `select course, status, queued_at from order_items where order_id = $1
          order by course`, [p.orderId]);

      expect(rows[0].status).toBe('queued');       // entrada foi
      expect(rows[1].status).toBe('held');         // sobremesa ficou
      // é isto que impede o KDS mostrar "atrasado" para algo que não foi mandado
      expect(rows[1].queued_at).toBeNull();
    });
  });

  it('liberar o curso manda para a cozinha e só então inicia o cronômetro', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [
        { product_id: AGUA, qty: 1, course: 1 },
        { product_id: PETIT_GATEAU, qty: 1, course: 3 },
      ]);
      await c.query(`select public.approve_order($1, $2::uuid[], '[]'::jsonb, $3::int[])`,
        [p.orderId, p.itens.map((i) => i.id), [3]]);

      const { rows: [r] } = await c.query(
        `select public.release_course($1, 3) as n`, [p.session_id]);
      expect(r.n).toBe(1);

      const { rows } = await c.query(
        `select status, queued_at from order_items where order_id = $1 and course = 3`,
        [p.orderId]);
      expect(rows[0].status).toBe('queued');
      expect(rows[0].queued_at).not.toBeNull();
    });
  });

  it('item retido JÁ conta no consumo da mesa', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 2, course: 2 }]);
      await c.query(`select public.approve_order($1, $2::uuid[], '[]'::jsonb, $3::int[])`,
        [p.orderId, p.itens.map((i) => i.id), [2]]);

      const { rows } = await c.query(
        `select subtotal_cents, pending_cents from session_totals where session_id = $1`,
        [p.session_id]);

      // o garçom aprovou: vai ser feito, então é consumo. Deixá-lo em
      // "aguardando" faria o total da mesa oscilar sem nada ter mudado.
      expect(rows[0].subtotal_cents).toBe(1400);
      expect(rows[0].pending_cents).toBe(0);
    });
  });
});

// ===========================================================================
describe('§5 — liberar mesa', () => {
  async function comandaEntregue(c: Client) {
    const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);
    await c.query(`select public.approve_order($1, $2::uuid[])`,
      [p.orderId, p.itens.map((i) => i.id)]);
    for (const s of ['preparing', 'ready', 'delivered']) {
      await c.query(`update order_items set status = $1 where order_id = $2`, [s, p.orderId]);
    }
    return p;
  }

  it('bloqueia enquanto houver item na cozinha', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);
      await c.query(`select public.approve_order($1, $2::uuid[])`,
        [p.orderId, p.itens.map((i) => i.id)]);

      await falhaCom(c, /na cozinha/i, `select public.release_table($1)`, [p.session_id]);
    });
  });

  it('§16 — garçom comum NÃO força liberação com saldo em aberto', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaEntregue(c);

      // consumo entregue e não pago: saldo positivo
      const { rows: [t] } = await c.query(
        `select balance_cents from session_totals where session_id = $1`, [p.session_id]);
      expect(t.balance_cents).toBeGreaterThan(0);

      await falhaCom(c, /gerente ou dono/i,
        `select public.release_table($1, true, 'cortesia_da_casa')`, [p.session_id]);
    });
  });

  it('sem forçar, saldo em aberto devolve o valor para a tela confirmar', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaEntregue(c);
      await falhaCom(c, /saldo/i, `select public.release_table($1)`, [p.session_id]);
    });
  });

  it('§16 — liberação forçada exige motivo e fica registrada', async () => {
    await como(DONO, async (c) => {
      const p = await comandaEntregue(c);

      await falhaCom(c, /motivo/i,
        `select public.release_table($1, true, null)`, [p.session_id]);

      await c.query(
        `select public.release_table($1, true, 'cliente_foi_embora_sem_pagar', 'saiu correndo')`,
        [p.session_id]);

      const { rows: [s] } = await c.query(
        `select status, force_released, released_by, release_reason, release_note
           from table_sessions where id = $1`, [p.session_id]);

      expect(s.status).toBe('closed');
      expect(s.force_released).toBe(true);
      expect(s.released_by).toBe(DONO);
      expect(s.release_reason).toBe('cliente_foi_embora_sem_pagar');

      // aparece na auditoria, que alimenta o painel do dono (spec §10.8)
      const { rows: log } = await c.query(
        `select action, after from audit_log
          where entity_id = $1 and action = 'table.force_released'`, [p.session_id]);
      expect(log).toHaveLength(1);
      expect(log[0].after.motivo).toBe('cliente_foi_embora_sem_pagar');
    });
  });

  it('saldo zerado: o garçom libera pelo caminho normal', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaEntregue(c);

      // paga a conta (como caixa, via postgres para não depender de papel)
      await c.query('set local role postgres');
      const { rows: [t] } = await c.query(
        `select total_cents from session_totals where session_id = $1`, [p.session_id]);
      await c.query(
        `insert into payments (restaurant_id, session_id, method, amount_cents,
                               created_by, idempotency_key)
         values ($1, $2, 'pix', $3, $4, $5)`,
        [RESTAURANTE_A, p.session_id, t.total_cents, CAIXA, `pg-${crypto.randomUUID()}`]);
      await c.query('set local role authenticated');

      await c.query(`select public.release_table($1)`, [p.session_id]);

      const { rows: [s] } = await c.query(
        `select status, force_released, release_reason from table_sessions where id = $1`,
        [p.session_id]);
      expect(s.status).toBe('closed');
      expect(s.force_released).toBe(false);
      expect(s.release_reason).toBeNull();
    });
  });

  it('§16 — o short_code NÃO muda ao liberar, e a mesa aceita comanda nova', async () => {
    await como(DONO, async (c) => {
      const p = await comandaEntregue(c);
      const { rows: [antes] } = await c.query(
        `select t.short_code from restaurant_tables t
           join table_sessions s on s.table_id = t.id where s.id = $1`, [p.session_id]);

      await c.query(
        `select public.release_table($1, true, 'cortesia_da_casa')`, [p.session_id]);

      const { rows: [depois] } = await c.query(
        `select short_code from restaurant_tables where short_code = $1`, [antes.short_code]);
      expect(depois.short_code).toBe(antes.short_code);

      // a etiqueta continua a mesma e abre uma comanda nova
      await c.query('set local role postgres');
      const { rows: [nova] } = await c.query(
        `select public.open_guest_session($1, 'Bruno', '', 'outro-dev', false) as r`,
        [antes.short_code]);
      expect(nova.r.session_id).not.toBe(p.session_id);
    });
  });
});

// ===========================================================================
describe('§5 — entrega e chamados', () => {
  it('só item pronto pode ser marcado como entregue', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);
      await c.query(`select public.approve_order($1, $2::uuid[])`,
        [p.orderId, p.itens.map((i) => i.id)]);

      await falhaCom(c, /não está pronto/i,
        `select public.mark_item_delivered($1)`, [p.itens[0].id]);

      await c.query(`update order_items set status = 'preparing' where id = $1`, [p.itens[0].id]);
      await c.query(`update order_items set status = 'ready' where id = $1`, [p.itens[0].id]);

      await c.query(`select public.mark_item_delivered($1)`, [p.itens[0].id]);

      const { rows } = await c.query(
        `select status, delivered_at from order_items where id = $1`, [p.itens[0].id]);
      expect(rows[0].status).toBe('delivered');
      expect(rows[0].delivered_at).not.toBeNull();
    });
  });

  it('chamado resolvido registra quem atendeu', async () => {
    await como(GARCOM, async (c) => {
      const p = await comandaComPedido(c, [{ product_id: AGUA, qty: 1 }]);

      await c.query('set local role postgres');
      const { rows: [chamado] } = await c.query(
        `insert into waiter_calls (restaurant_id, session_id, table_id, type)
         select $1, $2, s.table_id, 'call_waiter' from table_sessions s where s.id = $2
         returning id`, [RESTAURANTE_A, p.session_id]);
      await c.query('set local role authenticated');

      await c.query(`select public.resolve_waiter_call($1)`, [chamado.id]);

      const { rows } = await c.query(
        `select status, resolved_by, resolved_at from waiter_calls where id = $1`,
        [chamado.id]);
      expect(rows[0].status).toBe('resolved');
      expect(rows[0].resolved_by).toBe(GARCOM);
      expect(rows[0].resolved_at).not.toBeNull();
    });
  });
});

// ===========================================================================
describe('§10.11 — isolamento nas ações do garçom', () => {
  it('garçom do restaurante A não aprova pedido do restaurante B', async () => {
    // monta um pedido no restaurante B
    const b = await pool.connect();
    let orderId: string;
    let itemIds: string[];
    try {
      const { rows: [rest] } = await b.query(
        `insert into restaurants (name, slug) values ('Vizinho', 'vizinho-' || gen_random_uuid())
         returning id`);
      const { rows: [cat] } = await b.query(
        `insert into categories (restaurant_id, name) values ($1, 'Geral') returning id`,
        [rest.id]);
      const { rows: [prod] } = await b.query(
        `insert into products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Item B', 1000) returning id`, [rest.id, cat.id]);
      const { rows: [mesa] } = await b.query(
        `insert into restaurant_tables (restaurant_id, label) values ($1, 'Mesa B')
         returning short_code`, [rest.id]);
      const { rows: [s] } = await b.query(
        `select public.open_guest_session($1, 'Alguem', '', 'dev-b', false) as r`,
        [mesa.short_code]);
      const { rows: [o] } = await b.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
        [s.r.session_id, s.r.guest_id, `b-${crypto.randomUUID()}`,
         JSON.stringify([{ product_id: prod.id, qty: 1 }])]);
      orderId = o.id;
      const { rows } = await b.query(
        `select id from order_items where order_id = $1`, [orderId]);
      itemIds = rows.map((r) => r.id);
    } finally {
      b.release();
    }

    await como(GARCOM, async (c) => {
      // A RLS esconde a linha, então a função nem encontra o pedido —
      // a negação acontece antes de qualquer checagem de papel.
      await falhaCom(c, /não encontrado/i,
        `select public.approve_order($1, $2::uuid[])`, [orderId, itemIds]);
    });

    await pool.query(`delete from orders where id = $1`, [orderId]);
  });
});
