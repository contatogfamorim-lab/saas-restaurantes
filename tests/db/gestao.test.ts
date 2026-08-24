/**
 * Console de gestão (spec §8) e telefone do cliente (spec §10.9).
 *
 * O que precisa ser verdade:
 *
 *   1. faturamento é dado de dono, e a cozinha não chega nele por caminho
 *      nenhum — nem pelo app, nem pelo PostgREST;
 *   2. o telefone completo não sai por consulta comum, para ninguém, e quando
 *      sai deixa rastro sem o número dentro;
 *   3. relatório de produto usa o preço CONGELADO. Este é o teste que mais
 *      importa: um relatório que recalcula pelo catálogo mente devagar, só
 *      quando o preço muda, e ninguém percebe.
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
const CAIXA_A = 'aaaaaaaa-0000-4000-8000-000000000004';

const RESTAURANTE_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const DONO_B = 'bbbbbbbb-0000-4000-8000-000000000001';

/** As sete views que a §8 alimenta. */
const RELATORIOS = [
  'daily_sales',
  'payment_mix',
  'product_sales',
  'kitchen_performance',
  'rejected_items',
  'promotion_performance',
  'staff_money_actions',
  'customer_directory',
] as const;

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

/** Executa fora do papel, para montar cenário que o ator testado não pode criar. */
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
 * Roda um comando que DEVE falhar, e confere o motivo.
 *
 * O savepoint existe porque o Postgres aborta a transação inteira depois de um
 * erro: sem ele, o primeiro `esperaFalhar` inutiliza o resto do teste.
 *
 * A ARMADILHA QUE ESTAVA AQUI, e que vale contar: a primeira versão lançava
 * `esperava falha correspondendo a ${padrao}, mas passou` de DENTRO do `try`.
 * O `catch` logo abaixo pegava esse erro e testava o padrão contra a própria
 * mensagem — que contém o padrão, porque ele foi interpolado nela. A asserção
 * casava consigo mesma e o helper aprovava exatamente o caso que existia para
 * reprovar. Só apareceu quando eu soltei uma permissão de propósito e o teste
 * continuou verde.
 *
 * Por isso o caminho de sucesso sai pelo `return` e o erro de "não falhou" é
 * lançado FORA do try.
 */
async function esperaFalhar(c: Client, sql: string, params: unknown[], padrao: RegExp) {
  await c.query('savepoint tentativa');

  try {
    await c.query(sql, params as never[]);
  } catch (err) {
    await c.query('rollback to savepoint tentativa').catch(() => {});
    expect(String((err as Error).message)).toMatch(padrao);
    return;
  }

  await c.query('rollback to savepoint tentativa').catch(() => {});
  throw new Error(`o comando PASSOU, e deveria ter falhado com ${padrao}`);
}

/** Uma comanda paga, com um item, para os relatórios terem o que somar. */
async function comandaFechada(c: Client, precoCents = 2500) {
  const mesa = (
    await c.query(
      `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
      [RESTAURANTE_A],
    )
  ).rows[0].id as string;

  const produto = (
    await c.query(
      `select id from public.products where restaurant_id = $1 and is_available limit 1`,
      [RESTAURANTE_A],
    )
  ).rows[0].id as string;

  const sessao = (
    await c.query(
      `insert into public.table_sessions (restaurant_id, table_id, guest_count)
       values ($1, $2, 2) returning id`,
      [RESTAURANTE_A, mesa],
    )
  ).rows[0].id as string;

  const guest = (
    await c.query(
      `insert into public.session_guests (restaurant_id, session_id, display_name, phone, lgpd_consent_at)
       values ($1, $2, 'Tereza', '11987654321', now()) returning id`,
      [RESTAURANTE_A, sessao],
    )
  ).rows[0].id as string;

  const pedido = (
    await c.query(
      `insert into public.orders (restaurant_id, session_id, guest_id, source, idempotency_key)
       values ($1, $2, $3, 'guest', $4) returning id`,
      [RESTAURANTE_A, sessao, guest, `g-${crypto.randomUUID()}`],
    )
  ).rows[0].id as string;

  const item = (
    await c.query(
      `insert into public.order_items
         (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
          total_price_cents, station)
       values ($1, $2, $3, $4, 1, $5::int, $5::int, 'cozinha') returning id`,
      [RESTAURANTE_A, pedido, produto, guest, precoCents],
    )
  ).rows[0].id as string;

  await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);

  return { sessao, guest, item, produto };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);

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
    `insert into public.restaurants (id, name, slug) values ($1, 'Concorrente', 'concorrente')
     on conflict (id) do nothing`,
    [RESTAURANTE_B],
  );
  await pool.query(
    `insert into public.profiles (id, restaurant_id, name, roles)
     values ($1, $2, 'Dono B', array['owner']::staff_role[]) on conflict (id) do nothing`,
    [DONO_B, RESTAURANTE_B],
  );
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('§8 — relatório é dado de dono', () => {
  it('o administrador enxerga os relatórios', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await comoSistema(c, () => comandaFechada(c));

      for (const view of RELATORIOS) {
        const { rows } = await c.query(`select count(*)::int as n from public.${view}`);
        expect(rows[0].n, `${view} vazia para o dono`).toBeGreaterThan(0);
      }
    });
  });

  it('a cozinha não enxerga NENHUM relatório', async () => {
    await comoFuncionario(COZINHA_A, async (c) => {
      await comoSistema(c, () => comandaFechada(c));

      for (const view of RELATORIOS) {
        const { rows } = await c.query(`select count(*)::int as n from public.${view}`);
        expect(rows[0].n, `${view} vazou para a cozinha`).toBe(0);
      }
    });
  });

  it('garçom e caixa também não', async () => {
    // O caixa é quem MAIS parece que deveria: ele já vê pagamento de comanda
    // aberta. Ver o pagamento da mesa 4 é o trabalho dele; somar o faturamento
    // do mês é outra coisa.
    for (const ator of [GARCOM_A, CAIXA_A]) {
      await comoFuncionario(ator, async (c) => {
        await comoSistema(c, () => comandaFechada(c));

        for (const view of RELATORIOS) {
          const { rows } = await c.query(`select count(*)::int as n from public.${view}`);
          expect(rows[0].n, `${view} vazou para ${ator}`).toBe(0);
        }
      });
    }
  });

  it('o cliente anônimo não alcança relatório algum', async () => {
    await comoAnonimo(async (c) => {
      for (const view of RELATORIOS) {
        await esperaFalhar(
          c,
          `select count(*) from public.${view}`,
          [],
          /permission denied|permissão negada/i,
        );
      }
    });
  });

  it('o dono de A não vê número do restaurante B', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      for (const view of RELATORIOS) {
        const { rows } = await c.query(
          `select count(*)::int as n from public.${view} where restaurant_id = $1`,
          [RESTAURANTE_B],
        );
        expect(rows[0].n, `${view} vazou linha do restaurante B`).toBe(0);
      }
    });
  });
});

// ===========================================================================
describe('§P4 — relatório usa o preço CONGELADO', () => {
  it('mudar o preço do catálogo NÃO muda a venda de ontem', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { produto } = await comoSistema(c, () => comandaFechada(c, 2500));

      const antes = (
        await c.query(
          `select coalesce(sum(receita_cents), 0)::bigint as r
             from public.product_sales where product_id = $1`,
          [produto],
        )
      ).rows[0].r;

      // O dono dobra o preço no cardápio.
      await comoSistema(c, () =>
        c.query(`update public.products set price_cents = price_cents * 2 where id = $1`, [
          produto,
        ]),
      );

      const depois = (
        await c.query(
          `select coalesce(sum(receita_cents), 0)::bigint as r
             from public.product_sales where product_id = $1`,
          [produto],
        )
      ).rows[0].r;

      expect(Number(depois), 'o relatório seguiu o catálogo em vez do congelado').toBe(
        Number(antes),
      );
    });
  });
});

// ===========================================================================
describe('§10.9 — o telefone do cliente', () => {
  it('a coluna crua está fechada para TODO funcionário, dono incluído', async () => {
    for (const ator of [DONO_A, GARCOM_A, COZINHA_A, CAIXA_A]) {
      await comoFuncionario(ator, async (c) => {
        await esperaFalhar(
          c,
          `select phone from public.session_guests limit 1`,
          [],
          /permission denied|permissão negada/i,
        );
      });
    }
  });

  it('a máscara, essa sai — e é só ela', async () => {
    await comoFuncionario(GARCOM_A, async (c) => {
      const { guest } = await comoSistema(c, () => comandaFechada(c));

      // Ancorado NO cliente criado aqui. Um `limit 1` solto pegaria alguém da
      // semente e o teste passaria ou falharia conforme a ordem das linhas.
      const { rows } = await c.query(
        `select phone_mask from public.session_guests where id = $1`,
        [guest],
      );
      expect(rows[0].phone_mask).toMatch(/^•••••-\d{4}$/);
      // e os quatro dígitos são os últimos DE VERDADE — máscara que mostra os
      // primeiros quatro entregaria o DDD e a operadora
      expect(rows[0].phone_mask).toBe('•••••-4321');
    });
  });

  it('gerente e dono revelam o número inteiro', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { guest } = await comoSistema(c, () => comandaFechada(c));
      const { rows } = await c.query(`select public.reveal_guest_phone($1) as tel`, [guest]);
      expect(rows[0].tel).toBe('11987654321');
    });
  });

  it('garçom, cozinha e caixa não revelam', async () => {
    for (const ator of [GARCOM_A, COZINHA_A, CAIXA_A]) {
      await comoFuncionario(ator, async (c) => {
        const { guest } = await comoSistema(c, () => comandaFechada(c));
        await esperaFalhar(
          c,
          `select public.reveal_guest_phone($1)`,
          [guest],
          /permissão para ver o telefone/i,
        );
      });
    }
  });

  it('o dono de B não revela telefone de cliente de A', async () => {
    // A função é SECURITY DEFINER e não passa por RLS: o filtro por restaurante
    // dentro dela é a ÚNICA coisa segurando isto.
    //
    // O cliente é criado FORA de transação, pelo pool, e apagado no fim. A
    // primeira versão o criava dentro da transação de outra conexão com um
    // `commit`/`begin` no meio — e quando eu tirei o filtro de propósito para
    // conferir, o teste continuou verde: a linha nunca tinha ficado visível
    // para o dono de B, então a função falhava com "não encontrado" pelo motivo
    // ERRADO. Um teste que passa porque o cenário não montou é pior que
    // nenhum: ele afirma que a porta está trancada sem ter chegado nela.
    const mesa = (
      await pool.query(
        `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
        [RESTAURANTE_A],
      )
    ).rows[0].id as string;

    const sessao = (
      await pool.query(
        `insert into public.table_sessions (restaurant_id, table_id, guest_count)
         values ($1, $2, 2) returning id`,
        [RESTAURANTE_A, mesa],
      )
    ).rows[0].id as string;

    const guestDeA = (
      await pool.query(
        `insert into public.session_guests
           (restaurant_id, session_id, display_name, phone, lgpd_consent_at)
         values ($1, $2, 'Alvo', '11912345678', now()) returning id`,
        [RESTAURANTE_A, sessao],
      )
    ).rows[0].id as string;

    try {
      // Primeiro a prova de que o cenário EXISTE: o dono de A alcança a linha.
      await comoFuncionario(DONO_A, async (c) => {
        const { rows } = await c.query(`select public.reveal_guest_phone($1) as tel`, [
          guestDeA,
        ]);
        expect(rows[0].tel, 'o cenário não montou — a linha não está visível').toBe(
          '11912345678',
        );
      });

      // E só então a negação, que agora significa alguma coisa.
      await comoFuncionario(DONO_B, async (c) => {
        await esperaFalhar(
          c,
          `select public.reveal_guest_phone($1)`,
          [guestDeA],
          /não encontrado/i,
        );
      });
    } finally {
      await pool.query(`delete from public.session_guests where id = $1`, [guestDeA]);
      await pool.query(`delete from public.table_sessions where id = $1`, [sessao]);
      // O registro em audit_log FICA. Não é esquecimento: a tabela é imutável
      // por trigger, que vale inclusive para o dono do banco — e a consulta
      // aconteceu de verdade. Um teste que apagasse o próprio rastro estaria
      // provando o contrário do que a §10.8 pede.
    }
  });

  it('revelar deixa rastro — sem o número dentro', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { guest } = await comoSistema(c, () => comandaFechada(c));

      await c.query(`select public.reveal_guest_phone($1)`, [guest]);

      const { rows } = await c.query(
        `select actor_id, action, entity_id, before, after
           from public.audit_log
          where action = 'customer.view_full_phone' and entity_id = $1`,
        [guest],
      );

      expect(rows.length, 'o acesso não foi registrado').toBe(1);
      expect(rows[0].actor_id).toBe(DONO_A);

      const texto = JSON.stringify(rows[0]);
      expect(texto, 'o LOG guardou o telefone').not.toContain('11987654321');
      expect(texto, 'o log guardou dígitos do telefone').not.toContain('987654321');
    });
  });

  it('cliente sem telefone devolve nulo, e não registra nada', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const guest = await comoSistema(c, async () => {
        const { sessao } = await comandaFechada(c);
        const r = await c.query(
          `insert into public.session_guests (restaurant_id, session_id, display_name)
           values ($1, $2, 'Sem telefone') returning id`,
          [RESTAURANTE_A, sessao],
        );
        return r.rows[0].id as string;
      });

      const { rows } = await c.query(`select public.reveal_guest_phone($1) as tel`, [guest]);
      expect(rows[0].tel).toBeNull();

      const log = await c.query(
        `select count(*)::int as n from public.audit_log
          where action = 'customer.view_full_phone' and entity_id = $1`,
        [guest],
      );
      expect(log.rows[0].n, 'registrou acesso a um telefone que não existe').toBe(0);
    });
  });
});
