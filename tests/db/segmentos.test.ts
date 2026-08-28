/**
 * Segmentos (migration 0058).
 *
 * O que precisa ser verdade:
 *
 *   1. TODO segmento parte do consentimento — nenhum é porta lateral para a
 *      lista inteira;
 *   2. a prévia e a montagem usam a MESMA função, então o número da tela é o
 *      número que vai receber;
 *   3. "sumidos" só alcança quem JÁ VEIO;
 *   4. o segmento fica GRAVADO: refazer a lista sem escolher nada refaz a
 *      mesma lista, e não vira "todos" em silêncio;
 *   5. não existe mais a versão de `montar_publico` que ignora segmento.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const RESTAURANTE = '11111111-1111-4111-8111-111111111111';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000001';

let pool: Pool;

async function comoPostgres<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

async function viraStaff(c: Client, uid: string) {
  await c.query(
    `select set_config('request.jwt.claims',
       json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [uid],
  );
  await c.query('set local role authenticated');
}

function cpf() {
  return String(Math.floor(10_000_000_000 + Math.random() * 89_999_999_999));
}

async function clienteAceito(c: Client, nome = 'Fulano'): Promise<string> {
  const { rows } = await c.query(
    `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
     values ($1, $2, $3, '11999990000', 'x') returning id`,
    [RESTAURANTE, cpf(), nome],
  );
  await c.query(`select public.aceitar_marketing($1)`, [rows[0].id]);
  return rows[0].id;
}

async function comSaldo(c: Client, cliente: string, cents: number) {
  await c.query(
    `insert into public.customer_cashback_ledger
       (restaurant_id, customer_id, kind, amount_cents, available_at, base_cents, pct)
     values ($1, $2, 'credito', $3, now() - interval '1 hour', $3 * 20, 5)`,
    [RESTAURANTE, cliente, cents],
  );
}

/** Uma visita, com valor e data. */
async function visitou(c: Client, cliente: string, diasAtras: number, totalCents = 0) {
  const { rows: mesa } = await c.query(
    `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
    [RESTAURANTE],
  );
  const { rows: s } = await c.query(
    `insert into public.table_sessions
       (restaurant_id, table_id, guest_count, status, closed_at)
     values ($1, $2, 1, 'closed', now() - ($3 || ' days')::interval) returning id`,
    [RESTAURANTE, mesa[0].id, diasAtras],
  );
  await c.query(
    `insert into public.session_guests
       (restaurant_id, session_id, display_name, customer_id, joined_at)
     values ($1, $2, 'Cliente', $3, now() - ($4 || ' days')::interval)`,
    [RESTAURANTE, s[0].id, cliente, diasAtras],
  );

  if (totalCents > 0) {
    const { rows: g } = await c.query(
      `select id from public.session_guests where session_id = $1 limit 1`, [s[0].id]);
    const { rows: prod } = await c.query(
      `select id, price_cents from public.products
        where restaurant_id = $1 and price_cents > 0 limit 1`, [RESTAURANTE]);
    const { rows: o } = await c.query(
      `insert into public.orders (restaurant_id, session_id, guest_id, source,
                                  idempotency_key, status, approved_by, approved_at)
       values ($1, $2, $3, 'guest', gen_random_uuid()::text, 'approved', $4, now())
       returning id`,
      [RESTAURANTE, s[0].id, g[0].id, DONO],
    );
    const { rows: i } = await c.query(
      `insert into public.order_items
         (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
          total_price_cents, station)
       values ($1, $2, $3, $4, 1, $5, $5, 'cozinha') returning id`,
      [RESTAURANTE, o[0].id, prod[0].id, g[0].id, totalCents],
    );
    for (const st of ['queued', 'preparing', 'ready', 'delivered']) {
      await c.query(`update public.order_items set status = $1 where id = $2`, [st, i[0].id]);
    }
  }
}

async function conta(c: Client, seg: object): Promise<number> {
  const { rows } = await c.query(
    `select count(*)::int as n from app.publico_do_segmento($1, $2::jsonb)`,
    [RESTAURANTE, JSON.stringify(seg)],
  );
  return rows[0].n;
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
});
afterAll(async () => {
  await pool.end();
});

describe('todo segmento parte do consentimento', () => {
  it('quem não aceitou não entra em nenhum deles', async () => {
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
         values ($1, $2, 'Sem Aceite', '11988887777', 'x') returning id`,
        [RESTAURANTE, cpf()],
      );
      await comSaldo(c, rows[0].id, 5000);
      await visitou(c, rows[0].id, 200, 30000);

      // Ela tem saldo, sumiu e gastou — casaria com os três filtros.
      for (const seg of [
        { tipo: 'todos' },
        { tipo: 'com_saldo', min_cents: 1 },
        { tipo: 'sumidos', dias: 30 },
        { tipo: 'melhores', min_cents: 1, dias: 365 },
      ]) {
        const { rows: r } = await c.query(
          `select count(*)::int as n from app.publico_do_segmento($1, $2::jsonb) s
            where s.customer_id = $3`,
          [RESTAURANTE, JSON.stringify(seg), rows[0].id],
        );
        expect({ seg: seg.tipo, n: r[0].n }).toEqual({ seg: seg.tipo, n: 0 });
      }
    });
  });

  it('quem saiu da lista some de todos eles', async () => {
    await comoPostgres(async (c) => {
      const cli = await clienteAceito(c);
      await comSaldo(c, cli, 5000);
      expect(await conta(c, { tipo: 'com_saldo', min_cents: 1 })).toBeGreaterThanOrEqual(1);

      await c.query(
        `update public.customers set marketing_opt_out_at = now() where id = $1`, [cli]);
      const { rows } = await c.query(
        `select count(*)::int as n from app.publico_do_segmento($1, '{"tipo":"com_saldo"}'::jsonb) s
          where s.customer_id = $2`,
        [RESTAURANTE, cli],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('com saldo', () => {
  it('alcança quem tem dinheiro parado na casa', async () => {
    await comoPostgres(async (c) => {
      const rico = await clienteAceito(c, 'Tem Saldo');
      const pobre = await clienteAceito(c, 'Sem Saldo');
      await comSaldo(c, rico, 3000);

      const { rows } = await c.query(
        `select s.customer_id from app.publico_do_segmento($1, '{"tipo":"com_saldo"}'::jsonb) s
          where s.customer_id = any($2)`,
        [RESTAURANTE, [rico, pobre]],
      );
      expect(rows.map((r) => r.customer_id)).toEqual([rico]);
    });
  });

  it('o piso corta quem tem pouco', async () => {
    await comoPostgres(async (c) => {
      const cli = await clienteAceito(c);
      await comSaldo(c, cli, 500);   // R$ 5

      const dentro = await c.query(
        `select count(*)::int as n from app.publico_do_segmento($1, $2::jsonb) s
          where s.customer_id = $3`,
        [RESTAURANTE, JSON.stringify({ tipo: 'com_saldo', min_cents: 2000 }), cli],
      );
      expect(dentro.rows[0].n).toBe(0);
    });
  });

  it('saldo ainda em carência não conta', async () => {
    await comoPostgres(async (c) => {
      const cli = await clienteAceito(c);
      await c.query(
        `insert into public.customer_cashback_ledger
           (restaurant_id, customer_id, kind, amount_cents, available_at, base_cents, pct)
         values ($1, $2, 'credito', 5000, now() + interval '20 hours', 100000, 5)`,
        [RESTAURANTE, cli],
      );
      const { rows } = await c.query(
        `select count(*)::int as n from app.publico_do_segmento($1, '{"tipo":"com_saldo"}'::jsonb) s
          where s.customer_id = $2`,
        [RESTAURANTE, cli],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('sumidos', () => {
  it('só quem JÁ VEIO', async () => {
    await comoPostgres(async (c) => {
      const nunca = await clienteAceito(c, 'Nunca Veio');
      const sumiu = await clienteAceito(c, 'Sumiu');
      await visitou(c, sumiu, 120);

      const { rows } = await c.query(
        `select s.customer_id from app.publico_do_segmento($1, $2::jsonb) s
          where s.customer_id = any($3)`,
        [RESTAURANTE, JSON.stringify({ tipo: 'sumidos', dias: 60 }), [nunca, sumiu]],
      );
      expect(rows.map((r) => r.customer_id)).toEqual([sumiu]);
    });
  });

  it('quem veio ontem não é sumido', async () => {
    await comoPostgres(async (c) => {
      const cli = await clienteAceito(c);
      await visitou(c, cli, 120);
      await visitou(c, cli, 1);

      const { rows } = await c.query(
        `select count(*)::int as n from app.publico_do_segmento($1, $2::jsonb) s
          where s.customer_id = $3`,
        [RESTAURANTE, JSON.stringify({ tipo: 'sumidos', dias: 60 }), cli],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('melhores', () => {
  it('alcança quem passou do piso no período', async () => {
    await comoPostgres(async (c) => {
      const bom = await clienteAceito(c, 'Gasta Bem');
      const pouco = await clienteAceito(c, 'Gasta Pouco');
      await visitou(c, bom, 10, 30000);
      await visitou(c, pouco, 10, 2000);

      const { rows } = await c.query(
        `select s.customer_id from app.publico_do_segmento($1, $2::jsonb) s
          where s.customer_id = any($3)`,
        [RESTAURANTE, JSON.stringify({ tipo: 'melhores', min_cents: 20000, dias: 90 }),
         [bom, pouco]],
      );
      expect(rows.map((r) => r.customer_id)).toEqual([bom]);
    });
  });

  it('gasto fora do período não conta', async () => {
    await comoPostgres(async (c) => {
      const cli = await clienteAceito(c);
      await visitou(c, cli, 300, 50000);

      const { rows } = await c.query(
        `select count(*)::int as n from app.publico_do_segmento($1, $2::jsonb) s
          where s.customer_id = $3`,
        [RESTAURANTE, JSON.stringify({ tipo: 'melhores', min_cents: 20000, dias: 90 }), cli],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('a prévia é o que vai receber', () => {
  it('contar_segmento e montar_publico dão o mesmo número', async () => {
    // Duas consultas parecidas divergiriam no primeiro ajuste, e a divergência
    // apareceria como a tela prometendo 47 e a fila entregando 300.
    await comoPostgres(async (c) => {
      for (let i = 0; i < 4; i++) {
        const cli = await clienteAceito(c, `Cliente ${i}`);
        if (i < 2) await comSaldo(c, cli, 4000);
      }
      const { rows: camp } = await c.query(
        `insert into public.message_campaigns (restaurant_id, titulo, corpo)
         values ($1, 'Teste', 'Mensagem de teste com tamanho suficiente') returning id`,
        [RESTAURANTE],
      );

      await viraStaff(c, DONO);
      const seg = JSON.stringify({ tipo: 'com_saldo', min_cents: 1 });
      const { rows: previa } = await c.query(
        `select public.contar_segmento($1::jsonb) as n`, [seg]);
      const { rows: montado } = await c.query(
        `select public.montar_publico($1, $2::jsonb) as n`, [camp[0].id, seg]);

      expect(montado[0].n).toBe(previa[0].n);
      expect(montado[0].n).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('o segmento fica gravado', () => {
  it('refazer a lista sem escolher nada refaz A MESMA lista', async () => {
    // Sem isto, "refazer" viraria "todos" em silêncio — e uma campanha de
    // nicho viraria disparo geral no segundo clique.
    await comoPostgres(async (c) => {
      const comSaldoId = await clienteAceito(c, 'Com Saldo');
      await comSaldo(c, comSaldoId, 4000);
      await clienteAceito(c, 'Sem Saldo A');
      await clienteAceito(c, 'Sem Saldo B');

      const { rows: camp } = await c.query(
        `insert into public.message_campaigns (restaurant_id, titulo, corpo)
         values ($1, 'Teste', 'Mensagem de teste com tamanho suficiente') returning id`,
        [RESTAURANTE],
      );

      await viraStaff(c, DONO);
      const primeiro = await c.query(
        `select public.montar_publico($1, '{"tipo":"com_saldo"}'::jsonb) as n`,
        [camp[0].id],
      );
      const segundo = await c.query(
        `select public.montar_publico($1) as n`, [camp[0].id]);

      expect(segundo.rows[0].n).toBe(primeiro.rows[0].n);

      await c.query('reset role');
      const { rows } = await c.query(
        `select segmento ->> 'tipo' as t from public.message_campaigns where id = $1`,
        [camp[0].id],
      );
      expect(rows[0].t).toBe('com_saldo');
    });
  });

  it('não existe mais a versão que ignora segmento', async () => {
    // Duas funções chamáveis por rpc('montar_publico') fariam o PostgREST
    // escolher pelo formato do corpo — e "montar sem segmento" cairia na
    // versão velha, que monta para todo mundo.
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'montar_publico'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].args).toMatch(/jsonb/);
    });
  });

  it('segmento desconhecido é recusado pelo banco', async () => {
    await comoPostgres(async (c) => {
      await c.query('savepoint t');
      try {
        await c.query(
          `insert into public.message_campaigns (restaurant_id, titulo, corpo, segmento)
           values ($1, 'X', 'Mensagem de teste com tamanho suficiente',
                   '{"tipo":"aniversariantes"}'::jsonb)`,
          [RESTAURANTE],
        );
        await c.query('rollback to savepoint t');
        throw new Error('aceitou um segmento que o código não sabe calcular');
      } catch (e) {
        await c.query('rollback to savepoint t').catch(() => {});
        expect(String((e as Error).message)).toMatch(/segmento_conhecido/);
      }
    });
  });
});
