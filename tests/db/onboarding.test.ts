/**
 * Onboarding (spec §14) e o limite do tenant.
 *
 * O que precisa ser verdade:
 *
 *   1. existe UMA porta para criar restaurante, e ela cobra na entrada o que as
 *      policies não têm como cobrar. As policies continuam fechadas — nenhuma
 *      foi afrouxada para o onboarding caber;
 *   2. o anônimo NÃO lista os restaurantes da plataforma. Era a lista de
 *      clientes do negócio saindo pela chave que vai no bundle;
 *   3. e o cardápio público continua abrindo. Os dois juntos: fechar a porta e
 *      quebrar a casa não é conserto.
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

/** Conta sem perfil: quem chega pelo site e ainda não tem restaurante. */
const RECEM_CHEGADO = 'cccccccc-0000-4000-8000-000000000001';

let pool: Pool;

async function como<T>(profileId: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    if (profileId) {
      await client.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [profileId],
      );
    }
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

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);

  await pool.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                             email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                             created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
             'recem@chegado.test', extensions.crypt('x', extensions.gen_salt('bf', 4)),
             now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
     on conflict (id) do nothing`,
    [RECEM_CHEGADO],
  );
});

afterAll(async () => {
  await pool?.query(`delete from auth.users where id = $1`, [RECEM_CHEGADO]).catch(() => {});
  await pool?.end();
});

// ===========================================================================
describe('§14 — criar restaurante', () => {
  it('as policies continuam fechadas: ninguém insere em restaurants direto', async () => {
    // O teste que impede alguém de "resolver" o onboarding abrindo a tabela.
    // Se um dia isto passar, a criação de tenant virou aberta para qualquer
    // token autenticado, em toda requisição, para sempre.
    for (const ator of [DONO_A, GARCOM_A, RECEM_CHEGADO]) {
      await como(ator, async (c) => {
        await esperaFalhar(
          c,
          `insert into public.restaurants (name, slug) values ('Invasor', 'invasor')`,
          [],
          /row-level security|policy|permission denied/i,
        );
      });
    }
  });

  it('conta nova cria restaurante e vira administrador', async () => {
    await como(RECEM_CHEGADO, async (c) => {
      const { rows } = await c.query(
        `select public.create_restaurant('Cantina da Nona', 'Ana Nona') as r`,
      );
      const r = rows[0].r as { restaurant_id: string; slug: string };

      const { rows: perfil } = await c.query(
        `select restaurant_id, name, roles from public.profiles where id = $1`,
        [RECEM_CHEGADO],
      );
      expect(perfil[0].restaurant_id).toBe(r.restaurant_id);
      // O driver devolve array de ENUM como texto cru (`{owner}`), e não como
      // array de verdade — ele só desserializa os tipos que conhece.
      expect(String(perfil[0].roles)).toBe('{owner}');
      expect(perfil[0].name).toBe('Ana Nona');
    });
  });

  it('o slug sai do nome, sem acento e sem pontuação', async () => {
    await como(RECEM_CHEGADO, async (c) => {
      const { rows } = await c.query(
        `select public.create_restaurant('Pizzaria do Zé — Açaí & Cia', 'Zé') ->> 'slug' as slug`,
      );
      expect(rows[0].slug).toBe('pizzaria-do-ze-acai-cia');
    });
  });

  it('o slug NÃO vem do cliente', async () => {
    // A função não tem parâmetro de slug, e é de propósito: deixar o cliente
    // escolher o endereço público é deixar alguém registrar `brasa-burger`
    // antes do Brasa Burger.
    const { rows } = await pool.query(
      `select pg_get_function_arguments(oid) as args from pg_proc
        where proname = 'create_restaurant' and pronamespace = 'public'::regnamespace`,
    );
    expect(rows[0].args).not.toMatch(/slug/i);
  });

  it('colisão de slug ganha sufixo ALEATÓRIO, não sequencial', async () => {
    await como(RECEM_CHEGADO, async (c) => {
      const { rows } = await c.query(
        `select public.create_restaurant('Brasa Burger', 'Outro') ->> 'slug' as slug`,
      );
      // `brasa-burger-2` contaria ao mundo que existe um `brasa-burger-1`.
      expect(rows[0].slug).not.toBe('brasa-burger');
      expect(rows[0].slug).not.toMatch(/^brasa-burger-\d+$/);
      expect(rows[0].slug).toMatch(/^brasa-burger-[0-9a-f]{6}$/);
    });
  });

  it('quem já tem restaurante não cria outro', async () => {
    // Duas linhas em `profiles` para o mesmo `auth.uid()` fariam
    // `app.current_restaurant_id()` escolher uma por acaso — isolamento de
    // tenant decidido por sorteio.
    await como(DONO_A, async (c) => {
      await esperaFalhar(
        c,
        `select public.create_restaurant('Segundo Restaurante', 'Marisa')`,
        [],
        /já pertence a um restaurante/i,
      );
    });
  });

  it('sem estar autenticado, não cria', async () => {
    await comoAnonimo(async (c) => {
      await esperaFalhar(
        c,
        `select public.create_restaurant('Anônimo', 'Ninguém')`,
        [],
        /permission denied|não autenticado|Entre na sua conta/i,
      );
    });
  });

  it('nome vazio ou gigante é recusado', async () => {
    await como(RECEM_CHEGADO, async (c) => {
      await esperaFalhar(
        c, `select public.create_restaurant('A', 'Ana')`, [], /2 a 80/i,
      );
      await esperaFalhar(
        c, `select public.create_restaurant('Ok', '')`, [], /Informe seu nome/i,
      );
    });
  });

  it('criar restaurante deixa rastro', async () => {
    await como(RECEM_CHEGADO, async (c) => {
      const { rows } = await c.query(
        `select public.create_restaurant('Rastreada', 'Ana') ->> 'restaurant_id' as id`,
      );
      await c.query('reset role');
      const { rows: trilha } = await c.query(
        `select action, actor_id from public.audit_log
          where entity_id = $1 and action = 'restaurant.created'`,
        [rows[0].id],
      );
      expect(trilha.length).toBe(1);
      expect(trilha[0].actor_id).toBe(RECEM_CHEGADO);
    });
  });
});

// ===========================================================================
describe('§14 — mesas em lote', () => {
  it('continua a numeração de onde parou', async () => {
    await como(DONO_A, async (c) => {
      const antes = (
        await c.query(
          `select id from public.restaurant_tables where restaurant_id = $1`,
          [RESTAURANTE_A],
        )
      ).rows.map((r) => r.id as string);

      await c.query(`select public.create_tables(3, 'Deck')`);

      // Diferença de conjuntos, e não `order by id desc limit 3`: `id` é UUID,
      // então ordenar por ele é ordem ALEATÓRIA, não de inserção. A primeira
      // versão deste teste passava ou falhava conforme o sorteio — e só
      // apareceu quando a suíte rodou de novo num banco recém-resetado.
      const { rows } = await c.query(
        `select label from public.restaurant_tables
          where restaurant_id = $1 and not (id = any($2::uuid[]))`,
        [RESTAURANTE_A, antes],
      );
      const rotulos = rows.map((r) => r.label as string);

      // Quem já tem "Mesa 1..8" e cria mais três quer 9, 10 e 11 — não três
      // duplicatas de "Mesa 1".
      expect(rotulos.length).toBe(3);
      expect(rotulos).toContain(`Mesa ${antes.length + 1}`);
      expect(new Set(rotulos).size).toBe(3);
    });
  });

  it('cada mesa nasce com short_code próprio e aleatório', async () => {
    await como(DONO_A, async (c) => {
      await c.query(`select public.create_tables(5)`);

      const { rows } = await c.query(
        `select short_code from public.restaurant_tables where restaurant_id = $1`,
        [RESTAURANTE_A],
      );
      const codigos = rows.map((r) => r.short_code as string);

      expect(new Set(codigos).size, 'código repetido').toBe(codigos.length);
      // Dez caracteres, sem 0/O/1/I/l: código curto ou sequencial deixaria
      // qualquer pessoa adivinhar o endereço da mesa vizinha (spec §10).
      for (const codigo of codigos) {
        expect(codigo).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/);
      }
    });
  });

  it('a cozinha não cria mesa', async () => {
    await como(COZINHA_A, async (c) => {
      await esperaFalhar(
        c, `select public.create_tables(2)`, [], /permissão para criar mesas/i,
      );
    });
  });

  it('quantidade fora do razoável é recusada', async () => {
    await como(DONO_A, async (c) => {
      await esperaFalhar(c, `select public.create_tables(0)`, [], /1 a 200/i);
      await esperaFalhar(c, `select public.create_tables(500)`, [], /1 a 200/i);
    });
  });

  it('prefixo com metacaractere de regex não quebra a função', async () => {
    // O prefixo entra numa expressão regular para descobrir a numeração. Um
    // `(` vindo do formulário derrubaria a consulta inteira.
    await como(DONO_A, async (c) => {
      const { rows } = await c.query(
        `select public.create_tables(2, 'Salão', 'Mesa (");--') as n`,
      );
      expect(rows[0].n).toBe(2);
    });
  });
});

// ===========================================================================
describe('§10 — o anônimo não conhece os outros restaurantes', () => {
  it('anon NÃO lista os restaurantes da plataforma', async () => {
    // Era a lista de clientes do negócio saindo pela chave anon, que vai no
    // bundle do navegador por definição.
    //
    // Aceita as DUAS negativas: erro de privilégio (o GRANT foi revogado) ou
    // zero linhas (a policy sumiu). São camadas diferentes e qualquer uma
    // basta; exigir só uma faria o teste quebrar ao apertar a outra — foi o
    // que aconteceu quando revoguei o GRANT e a asserção de "0 linhas" virou
    // "permission denied".
    await comoAnonimo(async (c) => {
      await c.query('savepoint tentativa');
      try {
        const { rows } = await c.query(`select count(*)::int as n from public.restaurants`);
        expect(rows[0].n, 'anon enxergou restaurante').toBe(0);
      } catch (err) {
        await c.query('rollback to savepoint tentativa').catch(() => {});
        expect(String((err as Error).message)).toMatch(/permission denied/i);
      }
    });
  });

  it('mas o cardápio público continua abrindo', async () => {
    // O contra-teste, e o que impede a "correção" de virar uma quebra: cinco
    // policies conferem se o restaurante está ativo, e subquery dentro de
    // policy passa pela RLS de quem consulta. Sem a função SECURITY DEFINER,
    // fechar `restaurants` zerava o cardápio inteiro.
    await comoAnonimo(async (c) => {
      const categorias = (
        await c.query(`select count(*)::int as n from public.categories`)
      ).rows[0].n as number;
      const produtos = (
        await c.query(`select count(*)::int as n from public.products`)
      ).rows[0].n as number;

      expect(categorias).toBeGreaterThan(0);
      expect(produtos).toBeGreaterThan(0);
    });
  });

  it('restaurante inativo some do cardápio público', async () => {
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`update public.restaurants set active = false where id = $1`, [
        RESTAURANTE_A,
      ]);
      await c.query('set local role anon');

      const { rows } = await c.query(
        `select count(*)::int as n from public.products where restaurant_id = $1`,
        [RESTAURANTE_A],
      );
      expect(rows[0].n).toBe(0);
    } finally {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  });

  it('o staff continua lendo o próprio restaurante', async () => {
    await como(DONO_A, async (c) => {
      const { rows } = await c.query(
        `select name from public.restaurants where id = $1`, [RESTAURANTE_A],
      );
      expect(rows[0].name).toBe('Brasa Burger');
    });
  });
});

// ===========================================================================
describe('§10.8 — mexer na taxa de serviço deixa rastro', () => {
  it('mudar service_fee_pct vai para o audit_log', async () => {
    // Entra em toda conta da casa, e é a mesma natureza de decisão que preço de
    // produto — que já ia para a trilha desde a 0013. A taxa não ia para lugar
    // nenhum.
    await como(DONO_A, async (c) => {
      await c.query(
        `update public.restaurants set service_fee_pct = 15 where id = $1`,
        [RESTAURANTE_A],
      );

      await c.query('reset role');
      const { rows } = await c.query(
        `select before, after, actor_id from public.audit_log
          where entity_id = $1 and action = 'restaurant.settings_changed'
          order by created_at desc limit 1`,
        [RESTAURANTE_A],
      );

      expect(rows.length).toBe(1);
      expect(Number(rows[0].after.service_fee_pct)).toBe(15);
      expect(rows[0].actor_id).toBe(DONO_A);
    });
  });

  it('mexer só no logo NÃO polui a trilha', async () => {
    // Trilha que registra tudo vira trilha que ninguém lê.
    await como(DONO_A, async (c) => {
      const antes = (
        await c.query(
          `select count(*)::int as n from public.audit_log where entity_id = $1`,
          [RESTAURANTE_A],
        )
      ).rows[0].n as number;

      await c.query(
        `update public.restaurants set logo_url = 'x/y.webp' where id = $1`,
        [RESTAURANTE_A],
      );

      const depois = (
        await c.query(
          `select count(*)::int as n from public.audit_log where entity_id = $1`,
          [RESTAURANTE_A],
        )
      ).rows[0].n as number;

      expect(depois).toBe(antes);
    });
  });
});
