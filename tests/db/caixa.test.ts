/**
 * Caixa: pagamento, desconto, taxa e fechamento (spec §7 e §10.7).
 *
 * Aqui o que está em jogo é dinheiro. O que precisa ser verdade:
 * ninguém paga mais que o saldo, ninguém desconta acima do próprio teto,
 * e nada acontece sem deixar rastro de quem fez.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

import { prepararBanco } from './_prepare';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE_A = '11111111-1111-4111-8111-111111111111';
const CAIXA = 'aaaaaaaa-0000-4000-8000-000000000004';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000001';
const GARCOM = 'aaaaaaaa-0000-4000-8000-000000000002';
const COZINHA = 'aaaaaaaa-0000-4000-8000-000000000003';

const SMASH = '44444444-0000-4000-8000-000000000001'; // R$ 32,00

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
 * Espera que a consulta falhe, sem envenenar a transação.
 *
 * No Postgres, um erro aborta o bloco inteiro: a próxima consulta responde
 * "current transaction is aborted" em vez do erro que interessa. O SAVEPOINT
 * isola cada tentativa, e é o que permite testar várias entradas inválidas
 * seguidas no mesmo teste.
 */
async function esperaFalhar(c: Client, sql: string, params: unknown[], padrao: RegExp) {
  await c.query('savepoint tentativa');
  try {
    await c.query(sql, params as never[]);
    throw new Error(`esperava falha correspondendo a ${padrao}, mas passou`);
  } catch (err) {
    await c.query('rollback to savepoint tentativa');
    expect(String((err as Error).message)).toMatch(padrao);
  }
}

/** Executa fora do papel, para montar cenário que a função testada não pode criar. */
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
 * Comanda com 2 smash entregues: consumo 6400 + taxa 640 = total 7040.
 * O caixa não abre mesa nem lança item, então o cenário é montado fora do papel.
 */
async function comandaFechavel(c: Client, mesa = 'Mesa 1') {
  return comoSistema(c, async () => {
    const { rows: [t] } = await c.query(
      `select id from restaurant_tables where restaurant_id = $1 and label = $2`,
      [RESTAURANTE_A, mesa],
    );
    const { rows: [s] } = await c.query(
      `insert into table_sessions (restaurant_id, table_id, waiter_id)
       values ($1, $2, $3) returning id`,
      [RESTAURANTE_A, t.id, GARCOM],
    );
    const { rows: [g1] } = await c.query(
      `insert into session_guests (restaurant_id, session_id, display_name)
       values ($1, $2, 'Tereza') returning id`, [RESTAURANTE_A, s.id]);
    const { rows: [g2] } = await c.query(
      `insert into session_guests (restaurant_id, session_id, display_name)
       values ($1, $2, 'Bruno') returning id`, [RESTAURANTE_A, s.id]);
    const { rows: [o] } = await c.query(
      `insert into orders (restaurant_id, session_id, guest_id, source, idempotency_key,
                           status, approved_by, approved_at)
       values ($1, $2, $3, 'guest', $4, 'approved', $5, now()) returning id`,
      [RESTAURANTE_A, s.id, g1.id, `cx-${crypto.randomUUID()}`, GARCOM]);

    for (const guest of [g1.id, g2.id]) {
      const { rows: [oi] } = await c.query(
        `insert into order_items (restaurant_id, order_id, product_id, guest_id, qty,
                                  unit_price_cents, total_price_cents, station)
         values ($1, $2, $3, $4, 1, 3200, 3200, 'cozinha') returning id`,
        [RESTAURANTE_A, o.id, SMASH, guest]);
      for (const st of ['queued', 'preparing', 'ready', 'delivered']) {
        await c.query(`update order_items set status = $1 where id = $2`, [st, oi.id]);
      }
    }

    return { sessionId: s.id as string, g1: g1.id as string, g2: g2.id as string };
  });
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('§7 — o total fecha', () => {
  it('consumo + taxa de 10% = total, e o saldo começa igual ao total', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      const { rows } = await c.query(
        `select subtotal_cents, service_fee_cents, total_cents, balance_cents
           from open_bills where session_id = $1`, [sessionId]);

      expect(rows[0].subtotal_cents).toBe(6400);
      expect(rows[0].service_fee_cents).toBe(640);
      expect(rows[0].total_cents).toBe(7040);
      expect(rows[0].balance_cents).toBe(7040);
    });
  });
});

describe('§7 e §10.7 — pagamento', () => {
  it('pagamento parcial abate e o saldo acompanha', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);

      const { rows } = await c.query(
        `select public.register_payment($1, 'pix', 3000, $2) as r`,
        [sessionId, `p-${crypto.randomUUID()}`]);
      expect(rows[0].r.saldo_restante_cents).toBe(4040);

      const saldo = await c.query(
        `select balance_cents from open_bills where session_id = $1`, [sessionId]);
      expect(saldo.rows[0].balance_cents).toBe(4040);
    });
  });

  it('vários métodos na mesma conta somam até quitar', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);

      await c.query(`select public.register_payment($1, 'pix', 3000, $2)`,
        [sessionId, `a-${crypto.randomUUID()}`]);
      await c.query(`select public.register_payment($1, 'credito', 2000, $2)`,
        [sessionId, `b-${crypto.randomUUID()}`]);
      await c.query(`select public.register_payment($1, 'dinheiro', 2040, $2, 5000)`,
        [sessionId, `c-${crypto.randomUUID()}`]);

      const { rows } = await c.query(
        `select paid_cents, balance_cents from open_bills where session_id = $1`,
        [sessionId]);
      expect(rows[0].paid_cents).toBe(7040);
      expect(rows[0].balance_cents).toBe(0);
    });
  });

  it('§10.7 — pagamento NÃO pode exceder o saldo', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await expect(
        c.query(`select public.register_payment($1, 'pix', 7041, $2)`,
          [sessionId, `x-${crypto.randomUUID()}`]),
      ).rejects.toThrow(/excede o saldo/i);
    });
  });

  it('§10.7 — dinheiro com troco: entra o valor da conta, não o entregue', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);

      const { rows } = await c.query(
        `select public.register_payment($1, 'dinheiro', 7040, $2, 10000) as r`,
        [sessionId, `t-${crypto.randomUUID()}`]);

      expect(rows[0].r.troco_cents).toBe(2960);

      const conta = await c.query(
        `select paid_cents, balance_cents from open_bills where session_id = $1`,
        [sessionId]);
      // o que entrou no caixa é a conta; o troco saiu
      expect(conta.rows[0].paid_cents).toBe(7040);
      expect(conta.rows[0].balance_cents).toBe(0);
    });
  });

  it('troco só existe em dinheiro', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await expect(
        c.query(`select public.register_payment($1, 'pix', 3000, $2, 5000)`,
          [sessionId, `y-${crypto.randomUUID()}`]),
      ).rejects.toThrow(/troco só existe em dinheiro/i);
    });
  });

  it('valor zero ou negativo é rejeitado', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      for (const valor of [0, -100]) {
        await esperaFalhar(
          c,
          `select public.register_payment($1, 'pix', $3, $2)`,
          [sessionId, `z${valor}-${crypto.randomUUID()}`, valor],
          /positivo/i,
        );
      }
    });
  });

  it('§13.7 — a mesma chave não cobra duas vezes', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      const chave = `repetida-${crypto.randomUUID()}`;

      const a = await c.query(
        `select public.register_payment($1, 'pix', 3000, $2) as r`, [sessionId, chave]);
      const b = await c.query(
        `select public.register_payment($1, 'pix', 3000, $2) as r`, [sessionId, chave]);

      expect(b.rows[0].r.repetido).toBe(true);
      expect(b.rows[0].r.payment_id).toBe(a.rows[0].r.payment_id);

      const conta = await c.query(
        `select paid_cents from open_bills where session_id = $1`, [sessionId]);
      expect(conta.rows[0].paid_cents).toBe(3000);
    });
  });

  it('o garçom não registra pagamento', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await comoFuncionario(GARCOM, async (outro) => {
        await expect(
          outro.query(`select public.register_payment($1, 'pix', 100, $2)`,
            [sessionId, `g-${crypto.randomUUID()}`]),
        ).rejects.toThrow(/permissão/i);
      });
    });
  });

  it('fica registrado quem recebeu', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await c.query(`select public.register_payment($1, 'pix', 1000, $2)`,
        [sessionId, `au-${crypto.randomUUID()}`]);

      const { rows } = await comoSistema(c, () =>
        c.query(`select actor_id, after from audit_log
                  where action = 'payment.recorded' order by created_at desc limit 1`));
      expect(rows[0].actor_id).toBe(CAIXA);
      expect(rows[0].after.valor_cents).toBe(1000);
    });
  });
});

// ===========================================================================
describe('§10.3 — teto de desconto por função', () => {
  it('o caixa desconta 10%', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      const { rows } = await c.query(
        `select public.apply_discount($1, 'Cliente reclamou da demora', null, 10) as r`,
        [sessionId]);
      expect(rows[0].r.valor_cents).toBe(640);

      const conta = await c.query(
        `select discount_cents, total_cents from open_bills where session_id = $1`,
        [sessionId]);
      expect(conta.rows[0].discount_cents).toBe(640);
      expect(conta.rows[0].total_cents).toBe(6400); // 6400 + 640 - 640
    });
  });

  it('o caixa NÃO passa de 10%', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await expect(
        c.query(`select public.apply_discount($1, 'Motivo qualquer', null, 30)`,
          [sessionId]),
      ).rejects.toThrow(/limite/i);
    });
  });

  it('quem administra passa', async () => {
    await comoFuncionario(DONO, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      const { rows } = await c.query(
        `select public.apply_discount($1, 'Cortesia da casa', null, 50) as r`,
        [sessionId]);
      // numeric do Postgres chega como string no driver — comparar com Number
      expect(Number(rows[0].r.percentual)).toBe(50);
    });
  });

  it('desconto em VALOR também respeita o teto percentual', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      // R$ 20 sobre consumo de R$ 64 são 31% — passa do teto do caixa mesmo
      // sem parecer, e é exatamente esse o buraco que a conversão fecha.
      await expect(
        c.query(`select public.apply_discount($1, 'Motivo qualquer', 2000, null)`,
          [sessionId]),
      ).rejects.toThrow(/limite/i);
    });
  });

  it('desconto sem motivo é rejeitado', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      for (const motivo of ['', '  ', 'ab']) {
        await esperaFalhar(
          c,
          `select public.apply_discount($1, $2, null, 5)`,
          [sessionId, motivo],
          /motivo/i,
        );
      }
    });
  });

  it('não aceita valor E percentual juntos', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await expect(
        c.query(`select public.apply_discount($1, 'Motivo bom', 500, 5)`, [sessionId]),
      ).rejects.toThrow(/valor OU percentual/i);
    });
  });

  it('a cozinha não dá desconto', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await comoFuncionario(COZINHA, async (outro) => {
        await expect(
          outro.query(`select public.apply_discount($1, 'Motivo bom', null, 5)`,
            [sessionId]),
        ).rejects.toThrow(/permissão/i);
      });
    });
  });
});

// ===========================================================================
describe('§7 — taxa de serviço', () => {
  it('remover zera a taxa e reduz o total', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await c.query(`select public.waive_service_fee($1, 'Atendimento demorado')`,
        [sessionId]);

      const { rows } = await c.query(
        `select service_fee_cents, service_fee_waived, total_cents
           from open_bills where session_id = $1`, [sessionId]);
      expect(rows[0].service_fee_waived).toBe(true);
      expect(rows[0].service_fee_cents).toBe(0);
      expect(rows[0].total_cents).toBe(6400);
    });
  });

  it('só pode ser removida uma vez', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await c.query(`select public.waive_service_fee($1, 'Primeiro motivo')`, [sessionId]);
      await expect(
        c.query(`select public.waive_service_fee($1, 'Segundo motivo')`, [sessionId]),
      ).rejects.toThrow(/já foi removida/i);
    });
  });

  it('exige motivo, e fica registrado quem removeu', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await esperaFalhar(
        c, `select public.waive_service_fee($1, '')`, [sessionId], /motivo/i);

      await c.query(`select public.waive_service_fee($1, 'Cliente esperou 50 min')`,
        [sessionId]);

      const { rows } = await comoSistema(c, () =>
        c.query(`select actor_id, after from audit_log
                  where action = 'service_fee.waived' and entity_id = $1`, [sessionId]));
      expect(rows[0].actor_id).toBe(CAIXA);
      expect(rows[0].after.motivo).toBe('Cliente esperou 50 min');
    });
  });
});

// ===========================================================================
describe('§16 — fechamento', () => {
  it('comanda NÃO fecha com saldo devedor pelo caminho normal', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await expect(
        c.query(`select public.release_table($1, false, null, null)`, [sessionId]),
      ).rejects.toThrow(/saldo/i);
    });
  });

  it('com saldo zerado, o caixa fecha normalmente', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await c.query(`select public.register_payment($1, 'pix', 7040, $2)`,
        [sessionId, `f-${crypto.randomUUID()}`]);

      await c.query(`select public.release_table($1, false, null, null)`, [sessionId]);

      const { rows } = await c.query(
        `select status, force_released from table_sessions where id = $1`, [sessionId]);
      expect(rows[0].status).toBe('closed');
      expect(rows[0].force_released).toBe(false);
    });
  });

  it('o caixa comum NÃO força liberação com saldo em aberto', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await expect(
        c.query(
          `select public.release_table($1, true, 'cliente_foi_embora_sem_pagar', null)`,
          [sessionId]),
      ).rejects.toThrow(/gerente ou dono/i);
    });
  });

  it('quem administra força, e a liberação fica registrada', async () => {
    await comoFuncionario(DONO, async (c) => {
      const { sessionId } = await comandaFechavel(c);

      await c.query(
        `select public.release_table($1, true, 'cliente_foi_embora_sem_pagar', null)`,
        [sessionId]);

      const { rows } = await c.query(
        `select status, force_released, release_reason, released_by
           from table_sessions where id = $1`, [sessionId]);
      expect(rows[0].force_released).toBe(true);
      expect(rows[0].release_reason).toBe('cliente_foi_embora_sem_pagar');
      expect(rows[0].released_by).toBe(DONO);

      const log = await c.query(
        `select before, after from audit_log
          where action = 'table.force_released' and entity_id = $1`, [sessionId]);
      // o saldo NO MOMENTO da liberação é estado anterior — fica em `before`
      expect(log.rows[0].before.saldo_cents).toBe(7040);
      expect(log.rows[0].after.motivo).toBe('cliente_foi_embora_sem_pagar');
    });
  });

  it('comanda fechada não aceita mais pagamento', async () => {
    await comoFuncionario(DONO, async (c) => {
      const { sessionId } = await comandaFechavel(c);
      await c.query(
        `select public.release_table($1, true, 'cortesia_da_casa', null)`, [sessionId]);

      await expect(
        c.query(`select public.register_payment($1, 'pix', 100, $2)`,
          [sessionId, `dep-${crypto.randomUUID()}`]),
      ).rejects.toThrow(/não está aberta/i);
    });
  });
});

// ===========================================================================
describe('§7 — divisão por pessoa', () => {
  it('cada comensal carrega o próprio consumo', async () => {
    await comoFuncionario(CAIXA, async (c) => {
      const { sessionId, g1, g2 } = await comandaFechavel(c);

      const { rows } = await c.query(
        `select oi.guest_id, sum(oi.total_price_cents)::int as total
           from order_items oi join orders o on o.id = oi.order_id
          where o.session_id = $1 and oi.status = 'delivered'
          group by oi.guest_id order by oi.guest_id`, [sessionId]);

      const porPessoa = Object.fromEntries(rows.map((r) => [r.guest_id, r.total]));
      expect(porPessoa[g1]).toBe(3200);
      expect(porPessoa[g2]).toBe(3200);
      // e a soma bate com o consumo da comanda
      expect(porPessoa[g1] + porPessoa[g2]).toBe(6400);
    });
  });
});
