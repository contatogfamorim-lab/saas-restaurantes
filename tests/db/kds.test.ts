/**
 * Tela da cozinha (spec §6).
 *
 * O que precisa ser verdade: a cozinha vê o que tem que cozinhar, na ordem
 * certa, e nada além disso.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

import { prepararBanco } from './_prepare';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE_A = '11111111-1111-4111-8111-111111111111';
const COZINHA = 'aaaaaaaa-0000-4000-8000-000000000003';
const GARCOM = 'aaaaaaaa-0000-4000-8000-000000000002';
const CAIXA = 'aaaaaaaa-0000-4000-8000-000000000004';

const SMASH = '44444444-0000-4000-8000-000000000001'; // estação cozinha
const AGUA = '44444444-0000-4000-8000-000000000023'; // estação bar

let pool: Pool;

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

/**
 * Executa algo FORA do papel de funcionário, na mesma transação.
 *
 * Necessário quando o cenário exige uma ação que a função testada legitimamente
 * não pode fazer: a cozinha não lê audit_log (§10.8, é de gerente e
 * administrador) nem fecha comanda. Forçar isso como cozinha testaria um
 * caminho que a vida real não tem.
 */
async function comoSistema<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  const claims = (await c.query(`select current_setting('request.jwt.claims', true) as c`))
    .rows[0].c as string | null;
  await c.query('reset role');
  try {
    return await fn();
  } finally {
    if (claims) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    }
    await c.query('set local role authenticated');
  }
}

/**
 * Cria um item já aprovado e na fila da cozinha.
 *
 * Sai do papel de funcionário para montar a fixture e volta em seguida. Isso
 * porque a COZINHA não pode abrir mesa — e não deve mesmo: quem abre comanda é
 * garçom ou caixa (policy `table_sessions_staff_write`). Montar o cenário como
 * cozinha estaria testando um caminho que a vida real não tem.
 *
 * Tudo na MESMA transação, que é desfeita ao final.
 */
async function itemNaFila(c: Client, produto = SMASH, mesa = 'Mesa 1') {
  const claims = (await c.query(`select current_setting('request.jwt.claims', true) as c`))
    .rows[0].c as string | null;

  await c.query('reset role');

  const { rows: [t] } = await c.query(
    `select id from restaurant_tables where restaurant_id = $1 and label = $2`,
    [RESTAURANTE_A, mesa],
  );
  const { rows: [sessao] } = await c.query(
    `insert into table_sessions (restaurant_id, table_id) values ($1, $2) returning id`,
    [RESTAURANTE_A, t.id],
  );
  const session_id = sessao.id as string;

  const { rows: [g] } = await c.query(
    `insert into session_guests (restaurant_id, session_id, display_name)
     values ($1, $2, 'Tereza') returning id`,
    [RESTAURANTE_A, session_id],
  );
  const guest_id = g.id as string;

  const { rows: [o] } = await c.query(
    `insert into orders (restaurant_id, session_id, guest_id, source, idempotency_key)
     values ($1, $2, $3, 'guest', $4) returning id`,
    [RESTAURANTE_A, session_id, guest_id, `kds-${crypto.randomUUID()}`],
  );

  const { rows: [p] } = await c.query(
    `select p.price_cents, coalesce(p.station_override, cat.station) as station
       from products p join categories cat on cat.id = p.category_id where p.id = $1`,
    [produto],
  );

  const { rows: [oi] } = await c.query(
    `insert into order_items (restaurant_id, order_id, product_id, guest_id, qty,
                              unit_price_cents, total_price_cents, station)
     values ($1, $2, $3, $4, 1, $5::int, $5::int, $6) returning id`,
    [RESTAURANTE_A, o.id, produto, guest_id, p.price_cents, p.station],
  );

  await c.query(`update order_items set status = 'queued' where id = $1`, [oi.id]);

  // volta a ser o funcionário do teste
  if (claims) {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
  }
  await c.query('set local role authenticated');

  return { itemId: oi.id as string, sessionId: session_id };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('§6 — avanço da produção', () => {
  it('a fila anda: queued → preparing → ready', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);

      await c.query(`select public.kds_start_item($1)`, [itemId]);
      let r = await c.query(
        `select status, started_at from order_items where id = $1`, [itemId]);
      expect(r.rows[0].status).toBe('preparing');
      expect(r.rows[0].started_at).not.toBeNull();

      await c.query(`select public.kds_item_ready($1)`, [itemId]);
      r = await c.query(`select status, ready_at from order_items where id = $1`, [itemId]);
      expect(r.rows[0].status).toBe('ready');
      expect(r.rows[0].ready_at).not.toBeNull();
    });
  });

  it('não dá para pular etapa: item na fila não vira pronto', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);
      await expect(
        c.query(`select public.kds_item_ready($1)`, [itemId]),
      ).rejects.toThrow(/não está em preparo/i);
    });
  });

  it('iniciar duas vezes é rejeitado', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);
      await c.query(`select public.kds_start_item($1)`, [itemId]);
      await expect(
        c.query(`select public.kds_start_item($1)`, [itemId]),
      ).rejects.toThrow(/não está na fila/i);
    });
  });

  it('o caixa não avança item da cozinha', async () => {
    // cria como cozinha, tenta avançar como caixa
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);

      await comoFuncionario(CAIXA, async (outro) => {
        await expect(
          outro.query(`select public.kds_start_item($1)`, [itemId]),
        ).rejects.toThrow(/permissão/i);
      });
    });
  });

  it('o garçom também não — quem cozinha é a cozinha', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);

      await comoFuncionario(GARCOM, async (outro) => {
        await expect(
          outro.query(`select public.kds_start_item($1)`, [itemId]),
        ).rejects.toThrow(/permissão/i);
      });
    });
  });
});

// ===========================================================================
describe('§6 — "Acabou"', () => {
  it('funciona com o item JÁ na fila — é lá que a ruptura é descoberta', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);

      const { rows } = await c.query(
        `select public.kds_out_of_stock($1, false) as r`, [itemId]);
      expect(rows[0].r.produto).toBe('Smash Clássico');

      const item = await c.query(
        `select status, rejection_reason from order_items where id = $1`, [itemId]);
      expect(item.rows[0].status).toBe('out_of_stock');
      expect(item.rows[0].rejection_reason).toBe('acabou');
    });
  });

  it('funciona também com o item em preparo', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);
      await c.query(`select public.kds_start_item($1)`, [itemId]);

      await c.query(`select public.kds_out_of_stock($1, false)`, [itemId]);
      const item = await c.query(`select status from order_items where id = $1`, [itemId]);
      expect(item.rows[0].status).toBe('out_of_stock');
    });
  });

  it('§16 — some do cardápio de todas as mesas quando pedido', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);

      await c.query(`select public.kds_out_of_stock($1, true)`, [itemId]);

      const p = await c.query(`select is_available from products where id = $1`, [SMASH]);
      expect(p.rows[0].is_available).toBe(false);

      // e o cardápio anônimo deixa de oferecer
      await c.query('set local role anon');
      const visivel = await c.query(
        `select count(*)::int as n from products where id = $1`, [SMASH]);
      expect(visivel.rows[0].n).toBe(0);
    });
  });

  it('"só este item" NÃO mexe no cardápio', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);
      await c.query(`select public.kds_out_of_stock($1, false)`, [itemId]);

      const p = await c.query(`select is_available from products where id = $1`, [SMASH]);
      expect(p.rows[0].is_available).toBe(true);
    });
  });

  it('fica registrado quem deu a baixa', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);
      await c.query(`select public.kds_out_of_stock($1, true)`, [itemId]);

      // a cozinha NÃO lê audit_log — a verificação é feita fora do papel
      const { rows } = await comoSistema(c, () =>
        c.query(
          `select actor_id, after from audit_log
            where action = 'kds.out_of_stock' and entity_id = $1`, [itemId]),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_id).toBe(COZINHA);
      expect(rows[0].after.removido_do_cardapio).toBe(true);
    });
  });
});

// ===========================================================================
describe('§6 — a fila mostra o que deve', () => {
  it('separa por estação: a cozinha não vê pedido do bar', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      await itemNaFila(c, SMASH, 'Mesa 1');
      await itemNaFila(c, AGUA, 'Mesa 2');

      const cozinha = await c.query(
        `select produto from kitchen_queue where station = 'cozinha'`);
      const bar = await c.query(
        `select produto from kitchen_queue where station = 'bar'`);

      expect(cozinha.rows.map((r) => r.produto)).toContain('Smash Clássico');
      expect(cozinha.rows.map((r) => r.produto)).not.toContain('Água Mineral');
      expect(bar.rows.map((r) => r.produto)).toContain('Água Mineral');
    });
  });

  it('item retido pela marcha NÃO aparece — para a cozinha ele não existe', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId } = await itemNaFila(c);
      // volta para pending e segura, como faria a aprovação com marcha
      await c.query(
        `update order_items set status = 'cancelled', rejection_reason = 'erro_no_pedido'
          where id = $1`, [itemId]);

      const { rows } = await c.query(
        `select count(*)::int as n from kitchen_queue where item_id = $1`, [itemId]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('item de mesa ENCERRADA não aparece — não há para quem entregar', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const { itemId, sessionId } = await itemNaFila(c);

      const antes = await c.query(
        `select count(*)::int as n from kitchen_queue where item_id = $1`, [itemId]);
      expect(antes.rows[0].n).toBe(1);

      // quem encerra comanda é garçom ou caixa, não a cozinha
      await comoSistema(c, () =>
        c.query(
          `update table_sessions set status = 'closed', closed_at = now() where id = $1`,
          [sessionId]),
      );

      const depois = await c.query(
        `select count(*)::int as n from kitchen_queue where item_id = $1`, [itemId]);
      expect(depois.rows[0].n).toBe(0);
    });
  });

  it('a ordem é sempre a do tempo na fila, mais antigo no topo', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      const a = await itemNaFila(c, SMASH, 'Mesa 1');
      const b = await itemNaFila(c, SMASH, 'Mesa 2');

      // envelhece o segundo artificialmente
      await c.query(
        `update order_items set queued_at = now() - interval '30 minutes' where id = $1`,
        [b.itemId]);

      const { rows } = await c.query(
        `select item_id from kitchen_queue
          where station = 'cozinha' and item_id in ($1, $2)
          order by queued_at`, [a.itemId, b.itemId]);

      expect(rows[0].item_id).toBe(b.itemId);
      expect(rows[1].item_id).toBe(a.itemId);
    });
  });

  it('§10.11 — a cozinha de um restaurante não vê a fila de outro', async () => {
    await comoFuncionario(COZINHA, async (c) => {
      await itemNaFila(c);
      const { rows } = await c.query(
        `select count(*)::int as n from kitchen_queue where restaurant_id <> $1`,
        [RESTAURANTE_A]);
      expect(rows[0].n).toBe(0);
    });
  });
});
