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

// ===========================================================================
describe('a demonstração nasce com prazo (0046)', () => {
  it('a marca de prazo sobrevive à geração que falha', async () => {
    // Foi o que aconteceu em produção: a geração falhou no meio, `expires_at`
    // nunca foi escrito, e quem pediu uma demonstração levou um restaurante
    // PERMANENTE — que a faxina não tinha como reconhecer.
    //
    // A primeira versão deste teste era VAZIA: eu punha o `update` dentro de
    // `gerar_demonstracao` e conferia depois de `esperaFalhar` — que desfaz o
    // savepoint, e com ele a própria linha que eu queria conferir. Pior: nem
    // adiantaria, porque `raise exception` já desfaz tudo o que a função
    // escreveu. A marca tem de vir de OUTRA transação.
    await como(DONO, async (c) => {
      await c.query(`set local role postgres`);
      await c.query(
        `update public.restaurants set expires_at = null where id = $1`, [RESTAURANTE],
      );
      await c.query(`set local role authenticated`);

      // O que a Server Action faz: marca primeiro, gera depois.
      await c.query(`select public.marcar_como_demonstracao()`);

      const marcado = (await c.query(
        `select expires_at is not null as tem from public.restaurants where id = $1`,
        [RESTAURANTE],
      )).rows[0].tem;
      expect(marcado, 'o prazo precisa estar gravado antes de gerar').toBe(true);

      // Agora a geração falha NO MEIO — e a marca continua lá, porque foi
      // escrita fora.
      //
      // O jeito de derrubá-la mudou junto com ela. Antes bastava arquivar o
      // cardápio, porque a demonstração dependia de um cardápio pré-existente;
      // desde a 0060 ela traz o próprio. Agora a queda vem de uma MESA JÁ
      // OCUPADA: a geração monta o cardápio inteiro, chega em `table_sessions`
      // e esbarra na regra de uma comanda aberta por mesa.
      //
      // Falhar no meio é o que importa. Um tipo inválido também derrubaria,
      // mas antes de escrever qualquer coisa — e aí o teste não provaria que a
      // marca sobrevive a um ROLLBACK de verdade.
      await c.query(`set local role postgres`);
      await c.query(
        `insert into public.table_sessions (restaurant_id, table_id, guest_count)
         select $1, id, 2 from public.restaurant_tables
          where restaurant_id = $1 and active
          order by label limit 1`,
        [RESTAURANTE],
      );
      await c.query(`set local role authenticated`);

      await esperaFalhar(
        c, `select public.gerar_demonstracao('hamburgueria')`, [],
        /duplicate key|uma comanda|table_sessions/i,
      );

      expect((await c.query(
        `select expires_at is not null as tem from public.restaurants where id = $1`,
        [RESTAURANTE],
      )).rows[0].tem, 'a marca não pode sumir com a falha').toBe(true);
    });
  });

  it('marcar duas vezes não estende o prazo', async () => {
    await como(DONO, async (c) => {
      await c.query(`set local role postgres`);
      await c.query(
        `update public.restaurants set expires_at = null where id = $1`, [RESTAURANTE],
      );
      await c.query(`set local role authenticated`);

      const a = (await c.query(`select public.marcar_como_demonstracao() as p`)).rows[0].p;
      const b = (await c.query(`select public.marcar_como_demonstracao() as p`)).rows[0].p;
      expect(String(b)).toBe(String(a));
    });
  });

  it('e a faxina está AGENDADA, não só oportunista', async () => {
    // A justificativa da 0034 — "sempre tem quem a dispare, todo visitante
    // novo" — é falsa num endereço de portfólio: passam dias sem ninguém gerar
    // demonstração, e nesse intervalo nada é limpo. Foi visto em produção, com
    // uma demo vencida há mais de um dia, intacta.
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select jobname, schedule, command from cron.job
          where jobname = 'faxina-das-demonstracoes'`,
      );
      expect(rows.length, 'a faxina precisa estar agendada').toBe(1);
      expect(rows[0].command).toContain('limpar_demos_vencidas');
    });
  });
});
