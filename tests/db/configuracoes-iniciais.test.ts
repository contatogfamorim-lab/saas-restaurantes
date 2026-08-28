/**
 * Configurações iniciais e as cinco demonstrações (migrations 0059–0060).
 *
 * O que precisa ser verdade:
 *
 *   1. restaurante de verdade nasce com CARDÁPIO VAZIO — o sistema não inventa
 *      o que a casa vende;
 *   2. o que vem de fábrica continua vindo: selos e restrições, que são
 *      vocabulário do sistema e não cardápio de ninguém;
 *   3. as cinco demonstrações geram cardápios DIFERENTES, com preço, e cada uma
 *      nasce com movimento acontecendo;
 *   4. a balada, que só tem bar, também gera operação — o caso que quebraria se
 *      o código assumisse que existe cozinha;
 *   5. o painel de progresso responde pelo BANCO, não por caixinha marcada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000001';
const GARCOM = 'aaaaaaaa-0000-4000-8000-000000000002';

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

/**
 * Uma casa nova, do zero — como sai do onboarding.
 *
 * O dono do seed é reaproveitado como dono dela: criar usuário em `auth.users`
 * à mão é a armadilha que já me custou tempo (o GoTrue exige colunas de token
 * como '' e não NULL), e o que este arquivo testa não é autenticação.
 */
async function casaNova(c: Client): Promise<{ restaurante: string; dono: string }> {
  const { rows: r } = await c.query(
    `insert into public.restaurants (name, slug, timezone)
     values ('Casa Nova', 'nova-' || substr(gen_random_uuid()::text, 1, 8),
             'America/Sao_Paulo') returning id`,
  );
  const { rows: u } = await c.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
             'authenticated', 'dono-' || substr(gen_random_uuid()::text,1,8) || '@teste.local',
             'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '')
     returning id`,
  );
  await c.query(
    `insert into public.profiles (id, restaurant_id, name, roles)
     values ($1, $2, 'Dona Nova', array['owner']::public.staff_role[])`,
    [u[0].id, r[0].id],
  );
  return { restaurante: r[0].id, dono: u[0].id };
}

async function conta(c: Client, tabela: string, restaurante: string): Promise<number> {
  const { rows } = await c.query(
    `select count(*)::int as n from public.${tabela} where restaurant_id = $1`,
    [restaurante],
  );
  return rows[0].n;
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
});
afterAll(async () => {
  await pool.end();
});

describe('o restaurante de verdade nasce vazio', () => {
  it('as configurações iniciais criam mesas e NENHUM produto', async () => {
    await comoPostgres(async (c) => {
      const casa = await casaNova(c);
      await viraStaff(c, casa.dono);

      await c.query(
        `select public.aplicar_configuracoes_iniciais(
           '{"mesas": 12, "taxa_servico": 10, "timezone": "America/Sao_Paulo"}'::jsonb)`,
      );
      await c.query('reset role');

      expect(await conta(c, 'restaurant_tables', casa.restaurante)).toBe(12);
      // O ponto do arquivo: zero. O sistema não sabe o que a casa vende.
      expect(await conta(c, 'products', casa.restaurante)).toBe(0);
      expect(await conta(c, 'categories', casa.restaurante)).toBe(0);
    });
  });

  it('o que é vocabulário do sistema continua vindo de fábrica', async () => {
    // Selos e restrições não são o cardápio de ninguém: "vegano" e "mais
    // pedido" significam a mesma coisa em qualquer casa.
    await comoPostgres(async (c) => {
      const casa = await casaNova(c);
      expect(await conta(c, 'product_badges', casa.restaurante)).toBeGreaterThan(0);
      expect(await conta(c, 'diet_restrictions', casa.restaurante)).toBeGreaterThan(0);
    });
  });

  it('a função que inventava cardápio não existe mais', async () => {
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.proname in ('catalogo_por_cozinha', 'aplicar_briefing')`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('garçom não faz as configurações iniciais', async () => {
    await comoPostgres(async (c) => {
      await viraStaff(c, GARCOM);
      await c.query('savepoint t');
      try {
        await c.query(`select public.aplicar_configuracoes_iniciais('{"mesas":5}'::jsonb)`);
        await c.query('rollback to savepoint t');
        throw new Error('o garçom configurou a casa');
      } catch (e) {
        await c.query('rollback to savepoint t').catch(() => {});
        expect(String((e as Error).message)).toMatch(/Só quem administra/);
      }
    });
  });
});

describe('as cinco demonstrações', () => {
  const TIPOS = ['hamburgueria', 'pizzaria', 'oriental', 'acaiteria', 'balada'];

  it('todas geram cardápio com preço e mesas', async () => {
    for (const tipo of TIPOS) {
      await comoPostgres(async (c) => {
        const casa = await casaNova(c);
        await viraStaff(c, casa.dono);
        const { rows } = await c.query(`select public.gerar_demonstracao($1) as r`, [tipo]);
        await c.query('reset role');

        expect({ tipo, produtos: rows[0].r.produtos > 0 }).toEqual({ tipo, produtos: true });
        expect({ tipo, mesas: rows[0].r.mesas > 0 }).toEqual({ tipo, mesas: true });

        const { rows: semPreco } = await c.query(
          `select count(*)::int as n from public.products
            where restaurant_id = $1 and price_cents = 0`,
          [casa.restaurante],
        );
        expect({ tipo, semPreco: semPreco[0].n }).toEqual({ tipo, semPreco: 0 });
      });
    }
  });

  it('cada tipo tem um cardápio DIFERENTE', async () => {
    // Cinco tipos que gerassem a mesma coisa seriam um tipo com cinco nomes.
    await comoPostgres(async (c) => {
      const vistos = new Set<string>();
      for (const tipo of TIPOS) {
        const { rows } = await c.query(
          `select string_agg(x ->> 0, '|' order by x ->> 0) as itens
             from jsonb_array_elements(app.cardapio_da_demonstracao($1)) b,
                  jsonb_array_elements(b -> 'itens') x`,
          [tipo],
        );
        expect(rows[0].itens).toBeTruthy();
        vistos.add(rows[0].itens);
      }
      expect(vistos.size).toBe(5);
    });
  });

  it('todas nascem com movimento acontecendo', async () => {
    // O valor da demonstração é ver o sistema VIVO. Cadastro preenchido e salão
    // vazio mostra um banco de dados, não um restaurante.
    for (const tipo of TIPOS) {
      await comoPostgres(async (c) => {
        const casa = await casaNova(c);
        await viraStaff(c, casa.dono);
        await c.query(`select public.gerar_demonstracao($1)`, [tipo]);
        await c.query('reset role');

        const { rows } = await c.query(
          `select count(*)::int as n from public.table_sessions
            where restaurant_id = $1 and status = 'open'`,
          [casa.restaurante],
        );
        expect({ tipo, mesasAbertas: rows[0].n }).toEqual({ tipo, mesasAbertas: 4 });

        const { rows: est } = await c.query(
          `select count(distinct oi.status)::int as n from public.order_items oi
            where oi.restaurant_id = $1`,
          [casa.restaurante],
        );
        // Pelo menos dois estados diferentes: é o que mostra a esteira andando.
        expect({ tipo, estados: est[0].n >= 2 }).toEqual({ tipo, estados: true });
      });
    }
  });

  it('a balada, que só tem bar, também gera operação', async () => {
    // O caso que quebraria se o código assumisse que existe cozinha — e que só
    // aparece no quinto tipo, depois de os quatro primeiros funcionarem.
    await comoPostgres(async (c) => {
      const casa = await casaNova(c);
      await viraStaff(c, casa.dono);
      await c.query(`select public.gerar_demonstracao('balada')`);
      await c.query('reset role');

      const { rows } = await c.query(
        `select count(*)::int as n from public.order_items where restaurant_id = $1`,
        [casa.restaurante],
      );
      expect(rows[0].n).toBe(4);
    });
  });

  it('tipo desconhecido é recusado', async () => {
    await comoPostgres(async (c) => {
      const casa = await casaNova(c);
      await viraStaff(c, casa.dono);
      await c.query('savepoint t');
      try {
        await c.query(`select public.gerar_demonstracao('churrascaria')`);
        await c.query('rollback to savepoint t');
        throw new Error('gerou uma demonstração de um tipo que não existe');
      } catch (e) {
        await c.query('rollback to savepoint t').catch(() => {});
        expect(String((e as Error).message)).toMatch(/desconhecido/);
      }
    });
  });

  it('não existe mais a versão sem tipo', async () => {
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'gerar_demonstracao'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].args).toBe('p_tipo text');
    });
  });
});

describe('o painel de progresso', () => {
  it('responde pelo banco, e não por caixinha marcada', async () => {
    await comoPostgres(async (c) => {
      const casa = await casaNova(c);
      await viraStaff(c, casa.dono);

      const vazio = await c.query(`select public.progresso_da_configuracao() as p`);
      const linhas = vazio.rows[0].p as { chave: string; feito: boolean }[];
      const por = Object.fromEntries(linhas.map((l) => [l.chave, l.feito]));

      expect(por.mesas).toBe(false);
      expect(por.cardapio).toBe(false);

      await c.query(
        `select public.aplicar_configuracoes_iniciais('{"mesas": 6}'::jsonb)`,
      );

      const depois = await c.query(`select public.progresso_da_configuracao() as p`);
      const por2 = Object.fromEntries(
        (depois.rows[0].p as { chave: string; feito: boolean }[]).map((l) => [l.chave, l.feito]),
      );
      expect(por2.mesas).toBe(true);
      // Mesas prontas, cardápio ainda não: é o estado real de quem acabou de
      // entrar, e o painel precisa dizer isso.
      expect(por2.cardapio).toBe(false);
    });
  });

  it('"preços" só fica feito quando NENHUM item está sem preço', async () => {
    // Item a R$ 0,00 fica fora do ar, e o dono descobre pela mesa vazia. Um
    // painel que dissesse "pronto" com metade do cardápio invisível seria pior
    // que painel nenhum.
    await comoPostgres(async (c) => {
      const casa = await casaNova(c);
      const { rows: cat } = await c.query(
        `insert into public.categories (restaurant_id, name, sort_order, station)
         values ($1, 'Teste', 1, 'cozinha') returning id`,
        [casa.restaurante],
      );
      await c.query(
        `insert into public.products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Com preço', 2000), ($1, $2, 'Sem preço', 0)`,
        [casa.restaurante, cat[0].id],
      );

      await viraStaff(c, casa.dono);
      const { rows } = await c.query(`select public.progresso_da_configuracao() as p`);
      const linha = (rows[0].p as { chave: string; feito: boolean; detalhe: string }[])
        .find((l) => l.chave === 'precos')!;

      expect(linha.feito).toBe(false);
      expect(linha.detalhe).toMatch(/1 sem preço/);
    });
  });

  it('cada linha diz ONDE resolver', async () => {
    // Um painel que aponta o que falta e não diz para onde ir transfere o
    // problema em vez de resolvê-lo.
    await comoPostgres(async (c) => {
      await viraStaff(c, DONO);
      const { rows } = await c.query(`select public.progresso_da_configuracao() as p`);
      for (const l of rows[0].p as { chave: string; onde: string; porque: string }[]) {
        expect({ chave: l.chave, temOnde: l.onde?.startsWith('/app') }).toEqual({
          chave: l.chave,
          temOnde: true,
        });
        expect({ chave: l.chave, temPorque: (l.porque ?? '').length > 20 }).toEqual({
          chave: l.chave,
          temPorque: true,
        });
      }
    });
  });
});
