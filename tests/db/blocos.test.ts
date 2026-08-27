/**
 * Blocos do cardápio (migration 0045).
 *
 * O que precisa ser verdade:
 *
 *   1. o layout ORDENA e ACRESCENTA, e NUNCA subtrai por omissão. Categoria
 *      sem bloco continua no cardápio — esconder comida por esquecimento seria
 *      o pior defeito possível num sistema de pedidos;
 *   2. mexer no rascunho não muda o que o cliente vê;
 *   3. bloco oculto e bloco fora da janela de horário não chegam ao celular;
 *   4. quem não tem `menu.structure` não mexe em nada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE = '11111111-1111-4111-8111-111111111111';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000001';
const GARCOM = 'aaaaaaaa-0000-4000-8000-000000000002';

let pool: Pool;

async function como<T>(uid: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('request.jwt.claims',
         json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [uid],
    );
    await client.query('set local role authenticated');
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

/**
 * Lê os blocos publicados como o APP os lê.
 *
 * `blocos_do_cardapio` é concedida só a `service_role`: o celular do cliente é
 * `anon`, e `menu_blocks` não está entre as tabelas que ele enxerga. Quem chama
 * é o servidor do Next com a chave de serviço. Aqui o papel é trocado para
 * `postgres` pelo mesmo motivo — e a recusa a `authenticated` é, ela mesma,
 * parte do desenho.
 */
async function blocosPublicados(c: Client): Promise<string> {
  await c.query(`set local role postgres`);
  const { rows } = await c.query(
    `select public.blocos_do_cardapio($1)::text as b`, [RESTAURANTE],
  );
  await c.query(`set local role authenticated`);
  return rows[0].b;
}

async function esperaFalhar(c: Client, sql: string, params: unknown[], padrao: RegExp) {
  await c.query('savepoint t');
  try {
    await c.query(sql, params as never[]);
  } catch (err) {
    await c.query('rollback to savepoint t').catch(() => {});
    expect(String((err as Error).message)).toMatch(padrao);
    return;
  }
  await c.query('rollback to savepoint t').catch(() => {});
  throw new Error(`o comando PASSOU, e deveria ter falhado com ${padrao}`);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('§12.10 — organizar o cardápio', () => {
  it('acrescenta e reordena trocando com o vizinho', async () => {
    await como(DONO, async (c) => {
      const a = (await c.query(`select public.adicionar_bloco('text','{"titulo":"A"}') as id`)).rows[0].id;
      const b = (await c.query(`select public.adicionar_bloco('text','{"titulo":"B"}') as id`)).rows[0].id;

      const ordem = async () => {
        const { rows } = await c.query(
          `select bl.config->>'titulo' as t from public.menu_blocks bl
             join public.menu_layouts l on l.id = bl.layout_id
            where l.status = 'draft' and bl.config ? 'titulo'
            order by bl.sort_order`,
        );
        return rows.map((r) => r.t);
      };

      expect(await ordem()).toEqual(['A', 'B']);

      await c.query(`select public.mover_bloco($1, 'cima')`, [b]);
      expect(await ordem()).toEqual(['B', 'A']);

      // Já é o primeiro: subir de novo não é erro, é o fim da lista.
      await c.query(`select public.mover_bloco($1, 'cima')`, [b]);
      expect(await ordem()).toEqual(['B', 'A']);

      await c.query(`select public.remover_bloco($1)`, [a]);
      expect(await ordem()).toEqual(['B']);
    });
  });

  it('mexer no RASCUNHO não muda o que o cliente vê', async () => {
    await como(DONO, async (c) => {
      const antes = await blocosPublicados(c);

      await c.query(`select public.adicionar_bloco('text','{"titulo":"invisivel"}')`);

      const depois = await blocosPublicados(c);

      expect(depois).toBe(antes);
      expect(depois).not.toContain('invisivel');
    });
  });

  it('só depois de publicar o bloco chega ao celular', async () => {
    await como(DONO, async (c) => {
      await c.query(`select public.adicionar_bloco('text','{"titulo":"agora vai"}')`);
      await c.query(`select public.publish_menu_layout()`);

      expect(await blocosPublicados(c)).toContain('agora vai');
    });
  });

  it('bloco oculto não chega ao celular', async () => {
    await como(DONO, async (c) => {
      const id = (await c.query(
        `select public.adicionar_bloco('text','{"titulo":"escondido"}') as id`,
      )).rows[0].id;
      await c.query(`select public.atualizar_bloco($1, null, true)`, [id]);
      await c.query(`select public.publish_menu_layout()`);

      expect(await blocosPublicados(c)).not.toContain('escondido');
    });
  });

  it('quem não tem menu.structure não mexe em bloco nenhum', async () => {
    await como(GARCOM, async (c) => {
      await esperaFalhar(
        c, `select public.adicionar_bloco('text','{}')`, [], /permissão para editar a estrutura/i,
      );
    });
  });

  it('bloco de outro restaurante não é alcançável', async () => {
    // `mover_bloco` e companhia filtram por `app.current_restaurant_id()`. Sem
    // isso, um id descoberto reorganizaria o cardápio da casa ao lado.
    await como(DONO, async (c) => {
      await esperaFalhar(
        c,
        `select public.mover_bloco('00000000-0000-4000-8000-000000000000','cima')`,
        [],
        /não encontrado/i,
      );
    });
  });
});
