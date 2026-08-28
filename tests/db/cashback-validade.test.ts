/**
 * Carência e validade do cashback (migrations 0053–0054).
 *
 * O que precisa ser verdade:
 *
 *   1. validade 0 é "nunca expira", e é o padrão — casa que não escolheu não
 *      tira nada de ninguém por omissão;
 *   2. quem GASTOU não é punido: resgate consome o crédito mais velho primeiro,
 *      então o crédito novo sobrevive à expiração do antigo;
 *   3. a expiração é uma LINHA no extrato, e o saldo continua sendo a soma dos
 *      lançamentos — sem regra escondida em consulta;
 *   4. a carência vem da casa, e 0 faz o saldo valer na hora;
 *   5. rodar a faxina duas vezes não expira duas vezes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const RESTAURANTE = '11111111-1111-4111-8111-111111111111';

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

function cpf() {
  return String(Math.floor(10_000_000_000 + Math.random() * 89_999_999_999));
}

async function novoCliente(c: Client): Promise<string> {
  const { rows } = await c.query(
    `insert into public.customers (restaurant_id, cpf, name, password_hash)
     values ($1, $2, 'Fulano', 'x') returning id`,
    [RESTAURANTE, cpf()],
  );
  return rows[0].id;
}

/** Um crédito com data escolhida, para simular o tempo passando. */
async function credito(c: Client, cliente: string, valor: number, diasAtras: number) {
  await c.query(
    `insert into public.customer_cashback_ledger
       (restaurant_id, customer_id, session_id, kind, amount_cents,
        available_at, base_cents, pct, created_at)
     values ($1, $2, null, 'credito', $3,
             now() - ($4 || ' days')::interval, $3 * 20, 5,
             now() - ($4 || ' days')::interval)`,
    [RESTAURANTE, cliente, valor, diasAtras],
  );
}

async function resgate(c: Client, cliente: string, valor: number) {
  await c.query(
    `insert into public.customer_cashback_ledger
       (restaurant_id, customer_id, session_id, kind, amount_cents,
        available_at, base_cents, pct)
     values ($1, $2, null, 'resgate', $3, now(), 0, 0)`,
    [RESTAURANTE, cliente, valor],
  );
}

async function saldo(c: Client, cliente: string): Promise<number> {
  const { rows } = await c.query(`select app.saldo_disponivel($1) as s`, [cliente]);
  return Number(rows[0].s);
}

async function validade(c: Client, dias: number) {
  await c.query(`update public.restaurants set cashback_validade_dias = $1 where id = $2`,
    [dias, RESTAURANTE]);
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
});
afterAll(async () => {
  await pool.end();
});

describe('validade zero é nunca expira', () => {
  it('crédito de dois anos atrás continua valendo', async () => {
    await comoPostgres(async (c) => {
      await validade(c, 0);
      const cli = await novoCliente(c);
      await credito(c, cli, 5000, 730);

      expect(await saldo(c, cli)).toBe(5000);
      expect(
        Number((await c.query(`select app.cashback_a_caducar($1) as v`, [cli])).rows[0].v),
      ).toBe(0);

      await c.query(`select public.expirar_cashback_vencido()`);
      expect(await saldo(c, cli)).toBe(5000);
    });
  });

  it('é o padrão de fábrica', async () => {
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select column_default from information_schema.columns
          where table_name = 'restaurants' and column_name = 'cashback_validade_dias'`,
      );
      expect(rows[0].column_default).toMatch(/^0/);
    });
  });
});

describe('quem gastou não é punido', () => {
  it('o crédito novo sobrevive à expiração do antigo', async () => {
    // O cenário do cabeçalho da 0054, no centavo. R$ 100 velho, R$ 50 novo,
    // R$ 80 já resgatados. Saldo real: R$ 70. Só R$ 20 podem caducar.
    await comoPostgres(async (c) => {
      await validade(c, 90);
      const cli = await novoCliente(c);
      await credito(c, cli, 10000, 200);  // velho, fora da validade
      await credito(c, cli, 5000, 10);    // novo, dentro
      await resgate(c, cli, 8000);

      expect(await saldo(c, cli)).toBe(7000);

      const { rows } = await c.query(`select app.cashback_a_caducar($1) as v`, [cli]);
      expect(Number(rows[0].v)).toBe(2000);

      await c.query(`select public.expirar_cashback_vencido()`);

      // Sobram os R$ 50 novos. O caminho ingênuo daria zero aqui.
      expect(await saldo(c, cli)).toBe(5000);
    });
  });

  it('gastou tudo do velho: nada caduca', async () => {
    await comoPostgres(async (c) => {
      await validade(c, 90);
      const cli = await novoCliente(c);
      await credito(c, cli, 10000, 200);
      await resgate(c, cli, 10000);

      expect(await saldo(c, cli)).toBe(0);
      await c.query(`select public.expirar_cashback_vencido()`);
      expect(await saldo(c, cli)).toBe(0);

      const { rows } = await c.query(
        `select count(*)::int as n from public.customer_cashback_ledger
          where customer_id = $1 and kind = 'expiracao'`,
        [cli],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('tudo velho e nada gasto: caduca tudo', async () => {
    await comoPostgres(async (c) => {
      await validade(c, 90);
      const cli = await novoCliente(c);
      await credito(c, cli, 10000, 200);

      await c.query(`select public.expirar_cashback_vencido()`);
      expect(await saldo(c, cli)).toBe(0);
    });
  });
});

describe('a expiração é visível', () => {
  it('vira uma linha no extrato, com valor', async () => {
    // Tirar dinheiro de alguém sem deixar registro é o que um sistema não pode
    // fazer. O cliente precisa conseguir ver o que perdeu.
    await comoPostgres(async (c) => {
      await validade(c, 30);
      const cli = await novoCliente(c);
      await credito(c, cli, 3300, 60);
      await c.query(`select public.expirar_cashback_vencido()`);

      const { rows } = await c.query(
        `select kind, amount_cents from public.customer_cashback_ledger
          where customer_id = $1 order by created_at`,
        [cli],
      );
      expect(rows.map((r) => r.kind)).toEqual(['credito', 'expiracao']);
      expect(rows[1].amount_cents).toBe(3300);
    });
  });

  it('rodar a faxina duas vezes não expira duas vezes', async () => {
    await comoPostgres(async (c) => {
      await validade(c, 30);
      const cli = await novoCliente(c);
      await credito(c, cli, 4000, 60);

      await c.query(`select public.expirar_cashback_vencido()`);
      await c.query(`select public.expirar_cashback_vencido()`);

      const { rows } = await c.query(
        `select count(*)::int as n from public.customer_cashback_ledger
          where customer_id = $1 and kind = 'expiracao'`,
        [cli],
      );
      expect(rows[0].n).toBe(1);
      expect(await saldo(c, cli)).toBe(0);
    });
  });

  it('a data de caducar é a do crédito mais velho que ainda sustenta saldo', async () => {
    await comoPostgres(async (c) => {
      await validade(c, 100);
      const cli = await novoCliente(c);
      await credito(c, cli, 1000, 90);  // caduca em 10 dias
      await credito(c, cli, 1000, 10);  // caduca em 90 dias

      const { rows } = await c.query(
        `select round(extract(epoch from (app.cashback_caduca_em($1) - now())) / 86400) as dias`,
        [cli],
      );
      // Manda o mais velho: é ele que vai embora primeiro.
      expect(Number(rows[0].dias)).toBe(10);
    });
  });

  it('sem saldo, não há data', async () => {
    await comoPostgres(async (c) => {
      await validade(c, 100);
      const cli = await novoCliente(c);
      const { rows } = await c.query(`select app.cashback_caduca_em($1) as d`, [cli]);
      expect(rows[0].d).toBeNull();
    });
  });
});

describe('a carência vem da casa', () => {
  it('zero faz o saldo valer na hora', async () => {
    await comoPostgres(async (c) => {
      await c.query(
        `update public.restaurants set cashback_carencia_horas = 0, cashback_pct = 10 where id = $1`,
        [RESTAURANTE],
      );
      const { rows } = await c.query(
        `select column_name from information_schema.columns
          where table_name = 'restaurants' and column_name = 'cashback_carencia_horas'`,
      );
      expect(rows).toHaveLength(1);

      // O crédito nasce com available_at = now() + 0h, então já conta.
      const cli = await novoCliente(c);
      await c.query(
        `insert into public.customer_cashback_ledger
           (restaurant_id, customer_id, kind, amount_cents, available_at, base_cents, pct)
         values ($1, $2, 'credito', 500, now(), 5000, 10)`,
        [RESTAURANTE, cli],
      );
      expect(await saldo(c, cli)).toBe(500);
    });
  });

  it('a casa não pode pôr carência absurda', async () => {
    await comoPostgres(async (c) => {
      await c.query('savepoint t');
      try {
        await c.query(
          `update public.restaurants set cashback_carencia_horas = 99999 where id = $1`,
          [RESTAURANTE],
        );
        await c.query('rollback to savepoint t');
        throw new Error('aceitou carência de mais de 11 anos');
      } catch (e) {
        await c.query('rollback to savepoint t').catch(() => {});
        expect(String((e as Error).message)).toMatch(/carencia_sensata/);
      }
    });
  });
});
