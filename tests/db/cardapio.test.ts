/**
 * Editor de cardápio (spec §12).
 *
 * O que precisa ser verdade:
 *
 *   1. quem não pode mexer no preço não pode mexer no preço POR CAMINHO NENHUM
 *      — nem editando, nem criando um item novo já precificado. A §12.9 chama
 *      alterar preço de vetor de fraude mais comum, e uma regra que vale só
 *      para o caminho que alguém lembrou de fechar não é uma regra;
 *   2. quem só pode dizer "acabou" continua podendo dizer "acabou". Guarda que
 *      trava o trabalho de verdade é removida na primeira sexta-feira cheia;
 *   3. produto não se apaga, se arquiva — e não se arquiva embaixo de uma
 *      comanda aberta;
 *   4. a lista de permissões delegáveis não aceita nada fora dela, nem pela
 *      função nem por UPDATE direto.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

import { DELEGATABLE_PERMISSIONS } from '@/lib/permissions';

import { prepararBanco } from './_prepare';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE_A = '11111111-1111-4111-8111-111111111111';
const DONO_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const GARCOM_A = 'aaaaaaaa-0000-4000-8000-000000000002';
const COZINHA_A = 'aaaaaaaa-0000-4000-8000-000000000003';

/** Criado aqui: o seed não tem gerente, e gerente é quem tem estrutura sem preço. */
const GERENTE_A = 'aaaaaaaa-0000-4000-8000-00000000000a';

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

async function umaCategoria(c: Client): Promise<string> {
  const { rows } = await c.query(
    `select id from public.categories where restaurant_id = $1 order by sort_order limit 1`,
    [RESTAURANTE_A],
  );
  return rows[0].id as string;
}

async function umProduto(c: Client): Promise<{ id: string; preco: number }> {
  const { rows } = await c.query(
    `select id, price_cents from public.products
      where restaurant_id = $1 and archived_at is null order by name limit 1`,
    [RESTAURANTE_A],
  );
  return { id: rows[0].id as string, preco: rows[0].price_cents as number };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);

  await pool.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                             email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                             created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
             -- E-mail PROPRIO deste teste, e nao o do seed.
             --
             -- O seed passou a ter um gerente de verdade, e a colisao foi no
             -- E-MAIL: o "on conflict (id)" abaixo nao pega isso, porque o id
             -- e outro. O arquivo inteiro caiu com 34 testes PULADOS, que e o
             -- pior modo de falhar: verde por ausencia.
             --
             -- E o afterAll daqui APAGA este usuario. Apontar para o gerente
             -- do seed faria este teste derrubar a conta que a verificacao de
             -- portas usa logo depois.
             'gerente-do-teste-cardapio@brasaburger.test',
             extensions.crypt('x', extensions.gen_salt('bf', 4)),
             now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
     on conflict (id) do nothing`,
    [GERENTE_A],
  );
  await pool.query(
    `insert into public.profiles (id, restaurant_id, name, roles)
     values ($1, $2, 'Gerente de Teste', array['manager']::staff_role[])
     on conflict (id) do update set roles = array['manager']::staff_role[],
                                    permissions = array[]::text[]`,
    [GERENTE_A, RESTAURANTE_A],
  );
});

afterAll(async () => {
  await pool?.query(`delete from public.profiles where id = $1`, [GERENTE_A]).catch(() => {});
  await pool?.query(`delete from auth.users where id = $1`, [GERENTE_A]).catch(() => {});
  await pool?.end();
});

// ===========================================================================
describe('§12.9 — preço não escapa pela porta dos fundos', () => {
  it('a cozinha não cria produto nenhum', async () => {
    // A cozinha tem menu.availability. Antes desta etapa isso bastava para
    // INSERT, e ela criava item a R$ 99 — burlando o menu.price do dono
    // inventando um produto em vez de editar um.
    await comoFuncionario(COZINHA_A, async (c) => {
      const cat = await umaCategoria(c);
      await esperaFalhar(
        c,
        `insert into public.products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Fantasma da cozinha', 9900)`,
        [RESTAURANTE_A, cat],
        /menu\.price|row-level security|policy/i,
      );
    });
  });

  it('a cozinha não cria nem de graça', async () => {
    // Sem preço não é o guard que barra, é a policy: criar item é estrutura.
    await comoFuncionario(COZINHA_A, async (c) => {
      const cat = await umaCategoria(c);
      await esperaFalhar(
        c,
        `insert into public.products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Fantasma sem preço', 0)`,
        [RESTAURANTE_A, cat],
        /row-level security|policy/i,
      );
    });
  });

  it('o gerente cria o item, mas não nasce precificado', async () => {
    await comoFuncionario(GERENTE_A, async (c) => {
      const cat = await umaCategoria(c);

      await esperaFalhar(
        c,
        `insert into public.products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Novidade cara', 4500)`,
        [RESTAURANTE_A, cat],
        /menu\.price/i,
      );

      const { rows } = await c.query(
        `insert into public.products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Novidade sem preço', 0) returning id, price_cents`,
        [RESTAURANTE_A, cat],
      );
      expect(rows[0].price_cents).toBe(0);
    });
  });

  it('o dono cria já com preço', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const cat = await umaCategoria(c);
      const { rows } = await c.query(
        `insert into public.products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Item do dono', 4500) returning price_cents`,
        [RESTAURANTE_A, cat],
      );
      expect(rows[0].price_cents).toBe(4500);
    });
  });

  it('o gerente não muda preço de item existente', async () => {
    await comoFuncionario(GERENTE_A, async (c) => {
      const { id } = await umProduto(c);
      await esperaFalhar(
        c,
        `update public.products set price_cents = 100 where id = $1`,
        [id],
        /menu\.price/i,
      );
    });
  });

  it('ninguém APAGA produto — nem o dono', async () => {
    // order_items aponta para products: apagar quebraria a comanda de ontem e
    // o relatório de sempre. O caminho é arquivar.
    for (const ator of [DONO_A, GERENTE_A]) {
      await comoFuncionario(ator, async (c) => {
        const { id } = await umProduto(c);
        await esperaFalhar(
          c,
          `delete from public.products where id = $1`,
          [id],
          /permission denied|row-level security|policy/i,
        );
      });
    }
  });
});

// ===========================================================================
describe('§12 — quem só diz "acabou" continua dizendo', () => {
  it('a cozinha liga e desliga a disponibilidade', async () => {
    // O teste que impede a correção acima de virar um cadeado no trabalho de
    // verdade: marcar esgotado é a função da cozinha no cardápio.
    await comoFuncionario(COZINHA_A, async (c) => {
      const { id } = await umProduto(c);
      const { rows } = await c.query(
        `update public.products set is_available = false where id = $1 returning is_available`,
        [id],
      );
      expect(rows[0].is_available).toBe(false);
    });
  });

  it('a cozinha não muda preço nem nome', async () => {
    await comoFuncionario(COZINHA_A, async (c) => {
      const { id } = await umProduto(c);
      await esperaFalhar(
        c, `update public.products set price_cents = 1 where id = $1`, [id], /menu\.price/i,
      );
      await esperaFalhar(
        c, `update public.products set name = 'Renomeado' where id = $1`, [id], /menu\.content/i,
      );
    });
  });

  it('o garçom marca esgotado, que é o trabalho dele no salão', async () => {
    await comoFuncionario(GARCOM_A, async (c) => {
      const { id } = await umProduto(c);
      const { rows } = await c.query(
        `update public.products set is_available = false where id = $1 returning is_available`,
        [id],
      );
      expect(rows[0].is_available).toBe(false);
    });
  });
});

// ===========================================================================
describe('§12 — arquivar em vez de apagar', () => {
  it('arquivar tira do ar e registra quem foi', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { id } = await umProduto(c);
      await c.query(`select public.archive_product($1)`, [id]);

      const { rows } = await c.query(
        `select archived_at, archived_by, is_available from public.products where id = $1`,
        [id],
      );
      expect(rows[0].archived_at).not.toBeNull();
      expect(rows[0].archived_by).toBe(DONO_A);
      // arquivado e "disponível" ao mesmo tempo é um estado que não quer dizer nada
      expect(rows[0].is_available).toBe(false);

      const { rows: trilha } = await c.query(
        `select action from public.audit_log
          where entity_id = $1 and action = 'product.archived'`,
        [id],
      );
      expect(trilha.length).toBe(1);
    });
  });

  it('o gerente arquiva mesmo sem menu.availability explícito', async () => {
    // Arquivar desliga is_available junto. A guarda de coluna precisa entender
    // que isso é consequência de arquivar, não uma mudança de disponibilidade —
    // senão a permissão certa é barrada pela guarda da coluna errada.
    await comoFuncionario(GERENTE_A, async (c) => {
      const { id } = await umProduto(c);
      await c.query(`select public.archive_product($1)`, [id]);
      const { rows } = await c.query(
        `select archived_at from public.products where id = $1`, [id],
      );
      expect(rows[0].archived_at).not.toBeNull();
    });
  });

  it('a cozinha não arquiva', async () => {
    await comoFuncionario(COZINHA_A, async (c) => {
      const { id } = await umProduto(c);
      await esperaFalhar(
        c, `select public.archive_product($1)`, [id], /permissão para arquivar/i,
      );
    });
  });

  it('não arquiva item que está numa comanda aberta', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { id } = await umProduto(c);

      await comoSistema(c, async () => {
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
        const guest = (
          await c.query(
            `insert into public.session_guests (restaurant_id, session_id, display_name)
             values ($1, $2, 'Tereza') returning id`,
            [RESTAURANTE_A, sessao],
          )
        ).rows[0].id;
        const pedido = (
          await c.query(
            `insert into public.orders (restaurant_id, session_id, guest_id, source, idempotency_key)
             values ($1, $2, $3, 'guest', $4) returning id`,
            [RESTAURANTE_A, sessao, guest, `card-${crypto.randomUUID()}`],
          )
        ).rows[0].id;
        const prod = (
          await c.query(
            `select p.price_cents, coalesce(p.station_override, cat.station) as station
               from public.products p join public.categories cat on cat.id = p.category_id
              where p.id = $1`,
            [id],
          )
        ).rows[0];
        await c.query(
          `insert into public.order_items (restaurant_id, order_id, product_id, guest_id, qty,
                                           unit_price_cents, total_price_cents, station)
           values ($1, $2, $3, $4, 1, $5::int, $5::int, $6)`,
          [RESTAURANTE_A, pedido, id, guest, prod.price_cents, prod.station],
        );
      });

      await esperaFalhar(
        c, `select public.archive_product($1)`, [id], /comanda aberta/i,
      );
    });
  });

  it('desarquivar traz de volta', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const { id } = await umProduto(c);
      await c.query(`select public.archive_product($1)`, [id]);
      await c.query(`select public.archive_product($1, false)`, [id]);

      const { rows } = await c.query(
        `select archived_at from public.products where id = $1`, [id],
      );
      expect(rows[0].archived_at).toBeNull();

      const { rows: trilha } = await c.query(
        `select action from public.audit_log
          where entity_id = $1 and action = 'product.restored'`,
        [id],
      );
      expect(trilha.length).toBe(1);
    });
  });
});

// ===========================================================================
describe('§12.9 — delegação de permissão', () => {
  it('o dono delega menu.price e a pessoa passa a poder precificar', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await c.query(`select public.set_menu_permissions($1, array['menu.price'])`, [GERENTE_A]);
      await c.query('commit');
      await c.query('begin');
    });

    try {
      await comoFuncionario(GERENTE_A, async (c) => {
        const { id } = await umProduto(c);
        const { rows } = await c.query(
          `update public.products set price_cents = 3333 where id = $1 returning price_cents`,
          [id],
        );
        expect(rows[0].price_cents).toBe(3333);
      });
    } finally {
      await pool.query(
        `update public.profiles set permissions = array[]::text[] where id = $1`,
        [GERENTE_A],
      );
    }
  });

  it('ninguém edita as próprias permissões — nem o dono', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await esperaFalhar(
        c,
        `select public.set_menu_permissions($1, array['menu.price'])`,
        [DONO_A],
        /próprias permissões/i,
      );
    });
  });

  it('só o dono delega', async () => {
    for (const ator of [GERENTE_A, GARCOM_A, COZINHA_A]) {
      await comoFuncionario(ator, async (c) => {
        await esperaFalhar(
          c,
          `select public.set_menu_permissions($1, array['menu.price'])`,
          [COZINHA_A],
          /administra o restaurante/i,
        );
      });
    }
  });

  it('permissão fora da lista é recusada pela função', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await esperaFalhar(
        c,
        `select public.set_menu_permissions($1, array['menu.price','staff.manage'])`,
        [GERENTE_A],
        /não delegável/i,
      );
    });
  });

  it('e recusada também por UPDATE direto, que é o caminho que existia', async () => {
    // A função validava; a policy `profiles_owner_update` não restringe coluna,
    // então o dono gravava qualquer string por fora. Hoje quem barra é a
    // CHECK constraint, que não tem caminho de fora.
    await comoFuncionario(DONO_A, async (c) => {
      await esperaFalhar(
        c,
        `update public.profiles set permissions = array['permissao.inventada','*'] where id = $1`,
        [GERENTE_A],
        /profiles_permissions_delegatable|check constraint/i,
      );
    });
  });

  it('a lista do banco e a do TypeScript são a mesma', async () => {
    // Três lugares guardam esta lista: a constraint, app.delegatable_permissions()
    // e DELEGATABLE_PERMISSIONS. Elas se separando é exatamente o bug que
    // ninguém vê: a aplicação oferece uma permissão que o banco recusa, ou
    // pior, aceita uma que a aplicação nunca mostra.
    const { rows } = await pool.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'profiles_permissions_delegatable'`,
    );
    const definicao = rows[0].def as string;

    for (const p of DELEGATABLE_PERMISSIONS) {
      expect(definicao, `constraint não conhece ${p}`).toContain(p);
    }

    const { rows: doBanco } = await pool.query(
      `select unnest(app.delegatable_permissions()) as p`,
    );
    expect(doBanco.map((r) => r.p as string).sort()).toEqual([...DELEGATABLE_PERMISSIONS].sort());

    // e o contrário: nada a mais no banco
    const naConstraint = [...definicao.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(naConstraint)].sort()).toEqual([...DELEGATABLE_PERMISSIONS].sort());
  });
});

// ===========================================================================
describe('§12.8 — publicar e reverter', () => {
  it('publicar exige menu.publish', async () => {
    // O rascunho é criado pelo sistema para o teste medir a PERMISSÃO, e não
    // esbarrar antes em "não há rascunho" — que passaria pelo motivo errado.
    for (const ator of [GERENTE_A, GARCOM_A, COZINHA_A]) {
      await comoFuncionario(ator, async (c) => {
        await comoSistema(c, () =>
          c.query(
            `insert into public.menu_layouts (restaurant_id, status, version)
             select $1, 'draft', coalesce(max(version),0)+1
               from public.menu_layouts where restaurant_id = $1
             on conflict do nothing`,
            [RESTAURANTE_A],
          ),
        );
        await esperaFalhar(
          c, `select public.publish_menu_layout()`, [], /permissão para publicar/i,
        );
      });
    }
  });

  it('abrir o editor de layout exige menu.structure', async () => {
    for (const ator of [GARCOM_A, COZINHA_A]) {
      await comoFuncionario(ator, async (c) => {
        await esperaFalhar(
          c, `select public.ensure_draft_layout()`, [], /permissão para editar a estrutura/i,
        );
      });
    }
  });

  it('o rascunho novo nasce como cópia do que está no ar', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const publicados = (
        await c.query(
          `select count(*)::int as n from public.menu_blocks b
             join public.menu_layouts l on l.id = b.layout_id
            where l.restaurant_id = $1 and l.status = 'published'`,
          [RESTAURANTE_A],
        )
      ).rows[0].n as number;

      const rascunho = (
        await c.query(`select public.ensure_draft_layout() as id`)
      ).rows[0].id as string;

      const copiados = (
        await c.query(
          `select count(*)::int as n from public.menu_blocks where layout_id = $1`,
          [rascunho],
        )
      ).rows[0].n as number;

      // começar em branco faria o editor parecer que apagou o cardápio
      expect(copiados).toBe(publicados);
    });
  });

  it('chamar duas vezes devolve o MESMO rascunho', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const a = (await c.query(`select public.ensure_draft_layout() as id`)).rows[0].id;
      const b = (await c.query(`select public.ensure_draft_layout() as id`)).rows[0].id;
      expect(b).toBe(a);
    });
  });

  it('publicar promove o rascunho e abre outro, com os mesmos blocos', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      // O seed publica a v1 e não deixa rascunho: é o estado de quem acabou
      // de ser criado. Abrir o editor precisa funcionar nesse estado.
      const rascunho = {
        id: (await c.query(`select public.ensure_draft_layout() as id`)).rows[0].id as string,
      };

      await comoSistema(c, () =>
        c.query(
          `insert into public.menu_blocks (restaurant_id, layout_id, type, sort_order, config)
           values ($1, $2, 'banner', 1, '{"titulo":"Destaques"}'::jsonb)`,
          [RESTAURANTE_A, rascunho.id],
        ),
      );

      const { rows } = await c.query(`select public.publish_menu_layout() as r`);
      const r = rows[0].r as { publicado: string; versao: number; novo_rascunho: string };

      expect(r.publicado).toBe(rascunho.id);

      const { rows: publicado } = await c.query(
        `select status, published_at, published_by from public.menu_layouts where id = $1`,
        [rascunho.id],
      );
      expect(publicado[0].status).toBe('published');
      expect(publicado[0].published_by).toBe(DONO_A);

      // o novo rascunho nasce como cópia: quem publicou às 18h continua
      // editando às 18h05 sem mexer no que o cliente está vendo
      const { rows: publicados } = await c.query(
        `select type, config from public.menu_blocks where layout_id = $1 order by sort_order, type`,
        [rascunho.id],
      );
      const { rows: blocos } = await c.query(
        `select type, config from public.menu_blocks where layout_id = $1 order by sort_order, type`,
        [r.novo_rascunho],
      );

      expect(blocos.length).toBe(publicados.length);
      expect(blocos.map((b) => b.type)).toEqual(publicados.map((b) => b.type));
      expect(blocos.some((b) => b.config?.titulo === 'Destaques')).toBe(true);
    });
  });

  it('só existe um rascunho por restaurante', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await c.query(`select public.ensure_draft_layout()`);
      await c.query(`select public.publish_menu_layout()`);
      const { rows } = await c.query(
        `select count(*)::int as n from public.menu_layouts
          where restaurant_id = $1 and status = 'draft'`,
        [RESTAURANTE_A],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it('reverter republica uma versão antiga sem apagar a errada', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await c.query(`select public.ensure_draft_layout()`);
      const primeira = (
        await c.query(
          `select (public.publish_menu_layout() ->> 'versao')::int as v`,
        )
      ).rows[0].v as number;

      await c.query(`select public.publish_menu_layout()`);

      await c.query(`select public.revert_menu_layout($1)`, [primeira]);

      // Sem `order by`: no ar é quem está `published`, e só pode haver um.
      const { rows } = await c.query(
        `select version from public.menu_layouts
          where restaurant_id = $1 and status = 'published'`,
        [RESTAURANTE_A],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].version).toBe(primeira);

      // a versão que saiu do ar continua existindo, com o published_at dela
      const { rows: todas } = await c.query(
        `select count(*)::int as n from public.menu_layouts
          where restaurant_id = $1 and status = 'archived' and published_at is not null`,
        [RESTAURANTE_A],
      );
      expect(todas[0].n).toBeGreaterThanOrEqual(2);
    });
  });

  it('duas publicações na mesma transação deixam UM layout no ar', async () => {
    // O bug que este teste tranca: "qual está no ar" era o de `published_at`
    // mais recente, e `now()` é o horário da TRANSAÇÃO — as duas versões saíam
    // com o mesmo carimbo e a resposta virava sorteio. Foi assim que apareceu:
    // o teste de reverter falhava uma vez a cada três, sem nada mudar.
    await comoFuncionario(DONO_A, async (c) => {
      await c.query(`select public.ensure_draft_layout()`);
      await c.query(`select public.publish_menu_layout()`);
      await c.query(`select public.publish_menu_layout()`);

      const { rows } = await c.query(
        `select version, published_at from public.menu_layouts
          where restaurant_id = $1 and status = 'published'`,
        [RESTAURANTE_A],
      );
      expect(rows.length, 'mais de um cardápio no ar').toBe(1);
    });
  });

  it('o banco não deixa dois publicados nem por UPDATE direto', async () => {
    // A garantia é índice único, não disciplina de quem escreve a função.
    await comoFuncionario(DONO_A, async (c) => {
      await c.query(`select public.ensure_draft_layout()`);
      await c.query(`select public.publish_menu_layout()`);

      await esperaFalhar(
        c,
        `update public.menu_layouts set status = 'published'
          where restaurant_id = $1 and status = 'archived'`,
        [RESTAURANTE_A],
        /menu_layouts_one_published|duplicate key/i,
      );
    });
  });

  it('reverter não reescreve o published_at da versão que volta', async () => {
    // `published_at` conta QUANDO aquela versão foi feita. Sobrescrever no
    // revert apagaria qual é mais antiga — justamente o que alguém procura
    // quando está tentando entender o que aconteceu com o cardápio.
    await comoFuncionario(DONO_A, async (c) => {
      await c.query(`select public.ensure_draft_layout()`);
      const v = (
        await c.query(`select (public.publish_menu_layout() ->> 'versao')::int as v`)
      ).rows[0].v as number;

      const original = (
        await c.query(
          `select published_at from public.menu_layouts where restaurant_id = $1 and version = $2`,
          [RESTAURANTE_A, v],
        )
      ).rows[0].published_at;

      await c.query(`select public.publish_menu_layout()`);
      await c.query(`select public.revert_menu_layout($1)`, [v]);

      const depois = (
        await c.query(
          `select published_at from public.menu_layouts where restaurant_id = $1 and version = $2`,
          [RESTAURANTE_A, v],
        )
      ).rows[0].published_at;

      expect(depois).toEqual(original);
    });
  });

  it('reverter para versão que não existe falha', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      await esperaFalhar(
        c, `select public.revert_menu_layout($1)`, [9999], /não encontrada/i,
      );
    });
  });
});

// ===========================================================================
describe('§10.8 — a trilha do cardápio', () => {
  it('criar, esgotar e trocar conteúdo deixam rastro com quem foi', async () => {
    await comoFuncionario(DONO_A, async (c) => {
      const cat = await umaCategoria(c);

      const novo = (
        await c.query(
          `insert into public.products (restaurant_id, category_id, name, price_cents)
           values ($1, $2, 'Rastreado', 1500) returning id`,
          [RESTAURANTE_A, cat],
        )
      ).rows[0].id as string;

      await c.query(`update public.products set is_available = false where id = $1`, [novo]);
      await c.query(`update public.products set name = 'Rastreado II' where id = $1`, [novo]);
      await c.query(`update public.products set price_cents = 1900 where id = $1`, [novo]);

      const { rows } = await c.query(
        `select action, actor_id from public.audit_log where entity_id = $1 order by created_at`,
        [novo],
      );
      const acoes = rows.map((r) => r.action as string);

      expect(acoes).toContain('product.created');
      expect(acoes).toContain('product.unavailable');
      expect(acoes).toContain('product.content_changed');
      expect(acoes).toContain('product.price_changed');
      expect(rows.every((r) => r.actor_id === DONO_A)).toBe(true);
    });
  });

  it('o rastro de conteúdo não copia a descrição inteira nem a URL da foto', async () => {
    // O log é para alguém varrer, não para reconstruir o produto. E audit_log é
    // imutável: o que entra aqui não sai nunca mais.
    await comoFuncionario(DONO_A, async (c) => {
      const { id } = await umProduto(c);
      const longa = 'x'.repeat(400);

      await c.query(
        `update public.products set description = $2, image_url = $3 where id = $1`,
        [id, longa, 'https://exemplo.test/foto-secreta.webp'],
      );

      const { rows } = await c.query(
        `select before, after from public.audit_log
          where entity_id = $1 and action = 'product.content_changed'
          order by created_at desc limit 1`,
        [id],
      );

      const texto = JSON.stringify(rows[0].after);
      expect(texto.length).toBeLessThan(300);
      expect(texto).not.toContain('foto-secreta');
      expect(rows[0].after.foto).toBe(true);
    });
  });

  it('mexer em sort_order não polui a trilha', async () => {
    // Trilha que registra tudo vira trilha que ninguém lê.
    await comoFuncionario(DONO_A, async (c) => {
      const { id } = await umProduto(c);
      const antes = (
        await c.query(
          `select count(*)::int as n from public.audit_log where entity_id = $1`, [id],
        )
      ).rows[0].n as number;

      await c.query(`update public.products set sort_order = sort_order + 1 where id = $1`, [id]);

      const depois = (
        await c.query(
          `select count(*)::int as n from public.audit_log where entity_id = $1`, [id],
        )
      ).rows[0].n as number;

      expect(depois).toBe(antes);
    });
  });
});
