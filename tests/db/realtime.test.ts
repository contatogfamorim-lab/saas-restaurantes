/**
 * Realtime das telas da equipe (spec §9 e §10.2).
 *
 * "Realtime mal configurado vaza tabela inteira e é um erro silencioso."
 *
 * Silencioso é a palavra que importa: nada quebra, nenhum teste fica vermelho,
 * o dado só sai. Por isso estes testes atacam a policy pelos dois lados — o que
 * ela precisa deixar passar e o que ela precisa barrar — em vez de só conferir
 * que o canal funciona.
 *
 * O que ESTE arquivo não cobre: o servidor Realtime é outro processo e tem a
 * própria autorização de canal. A policy pode estar certa e ele entregar assim
 * mesmo. Essa metade é `pnpm check:realtime`, que assina de verdade.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

import { TABELAS_POR_TELA, type Tela } from '@/lib/realtime/canais';

import { prepararBanco } from './_prepare';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Só para o teste que precisa quebrar `realtime.send` — ver o teste que o usa. */
const SUPABASE_ADMIN_URL =
  process.env.SUPABASE_ADMIN_URL ??
  DATABASE_URL.replace('postgres:postgres@', 'supabase_admin:postgres@');

const RESTAURANTE_A = '11111111-1111-4111-8111-111111111111';
const GARCOM_A = 'aaaaaaaa-0000-4000-8000-000000000002';
const CAIXA_A = 'aaaaaaaa-0000-4000-8000-000000000004';

const RESTAURANTE_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const DONO_B = 'bbbbbbbb-0000-4000-8000-000000000001';

const CANAL_A = `restaurante:${RESTAURANTE_A}`;
const CANAL_B = `restaurante:${RESTAURANTE_B}`;

let pool: Pool;

/**
 * Roda como funcionário autenticado, com um tópico de canal em vigor.
 *
 * `realtime.topic()` lê `current_setting('realtime.topic')` — é assim que o
 * servidor Realtime informa ao banco qual canal está tentando autorizar. Sem
 * simular isso, a policy nunca seria exercida como na vida real.
 */
async function noCanal<T>(
  profileId: string,
  topico: string | null,
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
    await client.query(`select set_config('realtime.topic', $1, true)`, [topico ?? '']);
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

async function comoAnonimo<T>(topico: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local role anon');
    await client.query(`select set_config('realtime.topic', $1, true)`, [topico]);
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

/** Conta o que este ator enxerga em `realtime.messages`, por tópico. */
async function topicosVisiveis(c: Client): Promise<string[]> {
  const { rows } = await c.query(
    `select distinct topic from realtime.messages order by topic`,
  );
  return rows.map((r) => r.topic as string);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);

  // Restaurante B, o vizinho.
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

  // Um evento em cada canal, publicados como o banco publica.
  for (const canal of [CANAL_A, CANAL_B]) {
    await pool.query(
      `select realtime.send('{"tabela":"orders","op":"INSERT"}'::jsonb, 'mudanca', $1, true)`,
      [canal],
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('§10.2 — o canal é do restaurante, não do banco', () => {
  it('funcionário de A recebe eventos do próprio canal', async () => {
    await noCanal(GARCOM_A, CANAL_A, async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from realtime.messages where topic = $1`,
        [CANAL_A],
      );
      expect(rows[0].n).toBeGreaterThan(0);
    });
  });

  it('funcionário de A NÃO recebe nada no canal de B', async () => {
    await noCanal(GARCOM_A, CANAL_B, async (c) => {
      expect(await topicosVisiveis(c)).toEqual([]);
    });
  });

  it('funcionário de A, mesmo no próprio canal, não enxerga LINHA de B', async () => {
    // A metade que faltava na primeira versão da policy: ela autorizava pelo
    // tópico da sessão e nunca olhava a linha, então quem passasse na porta
    // lia a caixa inteira — inclusive as mensagens dos vizinhos.
    await noCanal(GARCOM_A, CANAL_A, async (c) => {
      expect(await topicosVisiveis(c)).toEqual([CANAL_A]);
    });
  });

  it('dono de B não enxerga o canal de A', async () => {
    await noCanal(DONO_B, CANAL_A, async (c) => {
      expect(await topicosVisiveis(c)).toEqual([]);
    });
    await noCanal(DONO_B, CANAL_B, async (c) => {
      expect(await topicosVisiveis(c)).toEqual([CANAL_B]);
    });
  });

  it('sem tópico em vigor, ninguém enxerga nada', async () => {
    // Um cliente que se conecte sem passar pelo caminho do Realtime não deve
    // conseguir ler a caixa de mensagens só por estar autenticado.
    await noCanal(GARCOM_A, null, async (c) => {
      expect(await topicosVisiveis(c)).toEqual([]);
    });
  });

  it('tópico inventado não abre nada', async () => {
    for (const inventado of ['restaurante:', 'restaurante:*', '*', 'restaurante:%']) {
      await noCanal(GARCOM_A, inventado, async (c) => {
        expect(await topicosVisiveis(c), `abriu com "${inventado}"`).toEqual([]);
      });
    }
  });

  it('o cliente anônimo não recebe evento de equipe', async () => {
    // A policy é `to authenticated`. `anon` tem GRANT de select na tabela — o
    // que segura é a ausência de policy, e é isso que este teste fixa.
    await comoAnonimo(CANAL_A, async (c) => {
      expect(await topicosVisiveis(c)).toEqual([]);
    });
  });
});

// ===========================================================================
describe('§10.2 — quem publica é o banco, nunca o cliente', () => {
  it('funcionário não consegue forjar um evento', async () => {
    // `authenticated` TEM grant de insert em realtime.messages (vem do Supabase).
    // O que impede é não existir policy de insert. Se alguém criar uma um dia,
    // este teste cai — e é para cair: um garçom que publica no canal faz a
    // cozinha inteira recarregar quando ele quiser.
    await noCanal(GARCOM_A, CANAL_A, async (c) => {
      await c.query('savepoint tentativa');
      await expect(
        c.query(
          `insert into realtime.messages (topic, extension, event, payload, private)
           values ($1, 'broadcast', 'mudanca', '{"tabela":"orders","op":"INSERT"}'::jsonb, true)`,
          [CANAL_A],
        ),
      ).rejects.toThrow(/row-level security|policy/i);
      await c.query('rollback to savepoint tentativa');
    });
  });

  it('funcionário não consegue apagar nem alterar evento', async () => {
    await noCanal(GARCOM_A, CANAL_A, async (c) => {
      const { rows } = await c.query(
        `update realtime.messages set payload = '{"tabela":"x","op":"X"}'::jsonb
          where topic = $1 returning id`,
        [CANAL_A],
      );
      expect(rows.length, 'conseguiu alterar mensagem').toBe(0);
    });
  });
});

// ===========================================================================
describe('§9 — o que faz a tela recarregar', () => {
  it('mexer nas tabelas da §9 publica evento no canal do restaurante', async () => {
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      await c.query('begin');

      const antes = (
        await c.query(`select count(*)::int as n from realtime.messages where topic = $1`, [
          CANAL_A,
        ])
      ).rows[0].n as number;

      const mesa = (
        await c.query(
          `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
          [RESTAURANTE_A],
        )
      ).rows[0].id;

      const sessao = (
        await c.query(
          `insert into public.table_sessions (restaurant_id, table_id, guest_count)
           values ($1, $2, 2) returning id`,
          [RESTAURANTE_A, mesa],
        )
      ).rows[0].id;

      await c.query(
        `insert into public.waiter_calls (restaurant_id, session_id, table_id, type)
         values ($1, $2, $3, 'call_waiter')`,
        [RESTAURANTE_A, sessao, mesa],
      );

      const depois = (
        await c.query(`select count(*)::int as n from realtime.messages where topic = $1`, [
          CANAL_A,
        ])
      ).rows[0].n as number;

      expect(depois - antes).toBeGreaterThanOrEqual(2);
    } finally {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  });

  it('o payload não carrega conteúdo de linha', async () => {
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      await c.query('begin');

      const mesa = (
        await c.query(
          `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
          [RESTAURANTE_A],
        )
      ).rows[0].id;

      const sessao = (
        await c.query(
          `insert into public.table_sessions (restaurant_id, table_id, guest_count, notes)
           values ($1, $2, 4, 'aniversário da Dona Cleuza') returning id`,
          [RESTAURANTE_A, mesa],
        )
      ).rows[0].id;

      const { rows } = await c.query(
        `select payload from realtime.messages
          where topic = $1 order by inserted_at desc limit 1`,
        [CANAL_A],
      );

      const payload = rows[0].payload as Record<string, unknown>;

      // Só o que mudou, nunca o que virou.
      expect(payload.tabela).toBe('table_sessions');
      expect(payload.op).toBe('INSERT');

      const texto = JSON.stringify(payload);
      expect(texto, 'vazou id de linha').not.toContain(sessao);
      expect(texto, 'vazou dado pessoal').not.toContain('Cleuza');
      expect(texto, 'vazou id da mesa').not.toContain(mesa);
    } finally {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  });

  /**
   * Os quatro cenários que a §9 lista, encenados de verdade.
   *
   * O que estes testes protegem não é o Realtime — é a LISTA de cada tela. O
   * hook ignora evento de tabela fora da lista, então tirar uma tabela de
   * `TABELAS_POR_TELA` deixa a tela muda sem quebrar nada: sem erro, sem teste
   * vermelho, só o pedido que não aparece. Aqui a ação real acontece, o que foi
   * publicado é coletado, e cada cenário confere se a tela que precisava saber
   * tinha aquela tabela na lista.
   */
  async function encenar<T>(
    montar: (c: Client) => Promise<T>,
    agir: (c: Client, ctx: T) => Promise<void>,
  ): Promise<string[]> {
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      await c.query('begin');

      // Montar a mesa também publica eventos. Sem separar as duas fases, todo
      // cenário "passaria" pelo `table_sessions` da montagem e o teste nunca
      // olharia a ação de verdade — foi o que aconteceu na primeira versão:
      // tirar `order_items` da lista da cozinha não derrubava nada.
      //
      // A marca é o conjunto de ids já publicados, não um horário: `inserted_at`
      // usa `now()`, que é o horário da TRANSAÇÃO, então tudo que este teste
      // publica sai com o mesmo carimbo e nenhum corte por tempo separaria a
      // montagem da ação.
      const ctx = await montar(c);
      const antes = (
        await c.query(`select id from realtime.messages where topic = $1`, [CANAL_A])
      ).rows.map((r) => r.id as string);

      await agir(c, ctx);

      const { rows } = await c.query(
        `select distinct payload ->> 'tabela' as tabela
           from realtime.messages
          where topic = $1 and not (id = any($2::uuid[]))`,
        [CANAL_A, antes],
      );
      return rows.map((r) => r.tabela as string).filter(Boolean);
    } finally {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  }

  function acorda(tela: Tela, publicadas: string[]) {
    const lista = TABELAS_POR_TELA[tela] as readonly string[];
    return publicadas.some((t) => lista.includes(t));
  }

  /** Mesa aberta com um pedido vazio — a montagem, nunca a ação medida. */
  async function montarMesa(c: Client) {
    const mesa = (
      await c.query(
        `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
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
        `insert into public.session_guests (restaurant_id, session_id, display_name)
         values ($1, $2, 'Tereza') returning id`,
        [RESTAURANTE_A, sessao],
      )
    ).rows[0].id as string;

    const pedido = (
      await c.query(
        `insert into public.orders (restaurant_id, session_id, guest_id, source, idempotency_key)
         values ($1, $2, $3, 'guest', $4) returning id`,
        [RESTAURANTE_A, sessao, guest, `rt-${crypto.randomUUID()}`],
      )
    ).rows[0].id as string;

    const prod = (
      await c.query(
        `select p.id, p.price_cents, coalesce(p.station_override, cat.station) as station
           from public.products p join public.categories cat on cat.id = p.category_id
          where p.restaurant_id = $1 and p.is_available limit 1`,
        [RESTAURANTE_A],
      )
    ).rows[0];

    return { mesa, sessao, guest, pedido, produto: prod };
  }

  type Mesa = Awaited<ReturnType<typeof montarMesa>>;

  /** O cliente mandando um item — a ação do cenário 1. */
  async function pedirItem(c: Client, m: Mesa) {
    const { rows } = await c.query(
      `insert into public.order_items (restaurant_id, order_id, product_id, guest_id, qty,
                                       unit_price_cents, total_price_cents, station)
       values ($1, $2, $3, $4, 1, $5::int, $5::int, $6) returning id`,
      [RESTAURANTE_A, m.pedido, m.produto.id, m.guest, m.produto.price_cents, m.produto.station],
    );
    return rows[0].id as string;
  }

  it('cenário 1 — cliente pede e o pedido aparece no salão', async () => {
    const publicadas = await encenar(montarMesa, async (c, m) => {
      await pedirItem(c, m);
    });

    expect(publicadas).toContain('order_items');
    expect(acorda('salao', publicadas), 'o salão não acorda com pedido novo').toBe(true);
  });

  it('cenário 2 — garçom aprova e o item entra na fila da cozinha', async () => {
    const publicadas = await encenar(
      async (c) => {
        const m = await montarMesa(c);
        return { item: await pedirItem(c, m) };
      },
      async (c, { item }) => {
        await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
      },
    );

    expect(publicadas).toContain('order_items');
    expect(acorda('cozinha', publicadas), 'a cozinha não acorda com item aprovado').toBe(true);
  });

  it('cenário 3 — cozinha marca pronto e o salão fica sabendo', async () => {
    const publicadas = await encenar(
      async (c) => {
        const m = await montarMesa(c);
        const item = await pedirItem(c, m);
        await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
        await c.query(`select public.kds_start_item($1)`, [item]);
        return { item };
      },
      async (c, { item }) => {
        await c.query(`select public.kds_item_ready($1)`, [item]);
      },
    );

    expect(publicadas).toContain('order_items');
    expect(acorda('salao', publicadas), 'o salão não acorda com prato pronto').toBe(true);
  });

  it('cenário 4 — mesa pede a conta e o caixa fica sabendo', async () => {
    const publicadas = await encenar(montarMesa, async (c, m) => {
      await c.query(
        `insert into public.waiter_calls (restaurant_id, session_id, table_id, type)
         values ($1, $2, $3, 'request_bill')`,
        [RESTAURANTE_A, m.sessao, m.mesa],
      );
    });

    expect(publicadas).toEqual(['waiter_calls']);
    expect(acorda('caixa', publicadas), 'o caixa não acorda com pedido de conta').toBe(true);
    expect(acorda('salao', publicadas), 'o salão não acorda com mesa chamando').toBe(true);
  });

  it('pagamento acorda o caixa', async () => {
    const publicadas = await encenar(montarMesa, async (c, m) => {
      await c.query(
        `insert into public.payments (restaurant_id, session_id, method, amount_cents,
                                      idempotency_key, created_by)
         values ($1, $2, 'pix', 100, $3, $4)`,
        [RESTAURANTE_A, m.sessao, `rt-pg-${crypto.randomUUID()}`, CAIXA_A],
      );
    });

    expect(publicadas).toEqual(['payments']);
    expect(acorda('caixa', publicadas)).toBe(true);
  });

  it('falha ao publicar não derruba o pedido', async () => {
    // Um pedido tem que entrar mesmo com o Realtime quebrado: a tela recarrega
    // sozinha em alguns segundos, mas comanda perdida não volta. O trigger
    // engole a exceção — aqui eu quebro `realtime.send` de propósito para
    // provar que engole mesmo, em vez de confiar no `exception when others`.
    //
    // Conecta como `supabase_admin` porque o schema `realtime` é dele: o papel
    // `postgres` do Supabase não é superusuário e leva "permission denied for
    // schema realtime". Tudo dentro de uma transação desfeita — DDL em Postgres
    // é transacional, então a função original volta ao normal no rollback.
    const c = new Client({ connectionString: SUPABASE_ADMIN_URL });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`
        create or replace function realtime.send(
          payload jsonb, event text, topic text, private boolean default true
        ) returns void language plpgsql as $$
        begin raise exception 'realtime caiu'; end $$;
      `);

      const mesa = (
        await c.query(
          `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
          [RESTAURANTE_A],
        )
      ).rows[0].id;

      const { rows } = await c.query(
        `insert into public.table_sessions (restaurant_id, table_id, guest_count)
         values ($1, $2, 2) returning id`,
        [RESTAURANTE_A, mesa],
      );

      expect(rows[0].id, 'a mesa não abriu porque o realtime caiu').toBeTruthy();
    } finally {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  });
});
