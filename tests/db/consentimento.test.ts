/**
 * Consentimento de marketing (migration 0049).
 *
 * A pergunta que estes testes respondem é uma só: PODE mandar mensagem para
 * esta pessoa? Errar para o lado permissivo aqui não gera tela quebrada — gera
 * mensagem enviada para quem não pediu, que não tem desfazer.
 *
 * O que precisa ser verdade:
 *
 *   1. o público começa VAZIO. Ninguém é herdado por ter telefone no cadastro;
 *   2. o opt-out ganha do opt-in, e um opt-in NOVO reabilita;
 *   3. quem não tem telefone não entra na lista, mesmo tendo aceitado;
 *   4. o texto do consentimento é gravado, e vem do banco — não do navegador;
 *   5. ler o token (o GET da página de saída) NÃO descadastra ninguém;
 *   6. o token não sai para a equipe, e nem a view devolve telefone inteiro;
 *   7. a equipe tira da lista, e não tem como colocar.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE = '11111111-1111-4111-8111-111111111111';
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

/** O cliente na mesa não tem login: fala como `anon`. */
async function comoAnon<T>(fn: (c: Client) => Promise<T>): Promise<T> {
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

/**
 * Vira funcionário no meio de uma transação já aberta como `postgres`.
 *
 * Existe para os testes que precisam montar o cenário com privilégio e
 * verificá-lo sem: sem isso, o preparo teria que ser `commit`-ado para a outra
 * conexão enxergar — e a limpeza depois esbarraria no `audit_log`, que não
 * aceita DELETE nem do dono do banco.
 */
async function viraStaff(c: Client, uid: string) {
  await c.query(
    `select set_config('request.jwt.claims',
       json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [uid],
  );
  await c.query('set local role authenticated');
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

/**
 * CPF único por inserção.
 *
 * Aleatório, e não um contador: a primeira versão contava a partir de um valor
 * fixo, e bastou uma execução abortada no meio para o banco ficar com os
 * primeiros números já ocupados — daí em diante o arquivo inteiro falhava por
 * chave duplicada, um erro que não tem nada a ver com o que ele testa.
 *
 * Nenhum teste deste arquivo dá `commit`, justamente para não deixar rastro: o
 * `audit_log` é imutável, então o que for gravado aqui não tem como ser
 * apagado depois.
 */
function cpf() {
  return String(Math.floor(10_000_000_000 + Math.random() * 89_999_999_999));
}

async function novoCliente(
  c: Client,
  opts: { telefone?: string | null } = {},
): Promise<string> {
  const { rows } = await c.query(
    `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
     values ($1, $2, 'Fulano', $3, 'x') returning id`,
    [RESTAURANTE, cpf(), opts.telefone === undefined ? '11999990000' : opts.telefone],
  );
  return rows[0].id;
}

/** O público, contado com privilégio total — não é o teste de RLS, é o de regra. */
async function noPublico(c: Client, id: string): Promise<boolean> {
  const { rows } = await c.query(
    `select 1 from public.publico_de_marketing where id = $1`,
    [id],
  );
  return rows.length === 1;
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
});
afterAll(async () => {
  await pool.end();
});

describe('ninguém é herdado', () => {
  it('cliente com telefone, sem ter aceitado, não está no público', async () => {
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      expect(await noPublico(c, id)).toBe(false);
    });
  });

  it('nenhuma migration liga o consentimento por UPDATE em massa', async () => {
    // Esta asserção protege a decisão mais cara da 0049, e ela precisa ser
    // ESTRUTURAL. A versão anterior contava `marketing_opt_in_at is not null`
    // no banco e dava zero — mas dava zero porque o seed não tem cliente
    // nenhum: passaria com ou sem backfill, e passaria para sempre.
    //
    // O risco de verdade é futuro: alguém escreve uma migration de "backfill"
    // achando que está ajudando o cliente a não perder a base. É esse arquivo
    // que o teste procura.
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.sql'));
    expect(arquivos.length).toBeGreaterThan(40);

    const culpados: string[] = [];
    for (const f of arquivos) {
      const sql = await readFile(new URL(f, dir), 'utf8');
      // Fora do corpo das funções, `update ... set marketing_opt_in_at` só
      // pode ser backfill: o caminho legítimo é `aceitar_marketing`.
      const semFuncoes = sql.replace(/\$\$[\s\S]*?\$\$/g, '');
      if (/update[\s\S]{0,400}?marketing_opt_in_at\s*=/i.test(semFuncoes)) {
        culpados.push(f);
      }
    }
    expect(culpados).toEqual([]);
  });

  it('vários clientes com telefone, nenhum no público', async () => {
    // A contrapartida comportamental: o seed não tem cliente, então o cenário
    // "base cheia de gente que nunca aceitou" precisa ser montado à mão.
    await comoPostgres(async (c) => {
      const ids = [
        await novoCliente(c),
        await novoCliente(c, { telefone: '11988887777' }),
        await novoCliente(c, { telefone: '11977776666' }),
      ];
      const { rows } = await c.query(
        `select count(*)::int as n from public.publico_de_marketing where id = any($1)`,
        [ids],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('aceite sem texto é recusado pelo banco', async () => {
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      await esperaFalhar(
        c,
        `update public.customers set marketing_opt_in_at = now() where id = $1`,
        [id],
        /consentimento_tem_texto/,
      );
    });
  });
});

describe('aceitar e sair', () => {
  it('aceitar põe no público, com o texto do banco', async () => {
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      await c.query(`select public.aceitar_marketing($1)`, [id]);

      expect(await noPublico(c, id)).toBe(true);

      const { rows } = await c.query(
        `select marketing_consent_text as t, unsubscribe_token as tok
           from public.customers where id = $1`,
        [id],
      );
      // O texto não é uma string qualquer: nomeia a casa e o canal, e promete
      // a saída. É o que a pessoa vai ler de novo se reclamar.
      expect(rows[0].t).toMatch(/WhatsApp/);
      expect(rows[0].t).toMatch(/sair quando quiser/);
      expect(rows[0].tok).toHaveLength(24);
    });
  });

  it('aceitar duas vezes não reescreve a data', async () => {
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      await c.query(`select public.aceitar_marketing($1)`, [id]);
      const { rows: a } = await c.query(
        `select marketing_opt_in_at as d from public.customers where id = $1`,
        [id],
      );
      await c.query(`select public.aceitar_marketing($1)`, [id]);
      const { rows: b } = await c.query(
        `select marketing_opt_in_at as d from public.customers where id = $1`,
        [id],
      );
      expect(String(b[0].d)).toBe(String(a[0].d));
    });
  });

  it('o opt-out tira do público', async () => {
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      await c.query(`select public.aceitar_marketing($1)`, [id]);
      const { rows } = await c.query(
        `select unsubscribe_token as tok from public.customers where id = $1`,
        [id],
      );

      expect(
        (await c.query(`select public.descadastrar_marketing($1) as ok`, [rows[0].tok]))
          .rows[0].ok,
      ).toBe(true);
      expect(await noPublico(c, id)).toBe(false);
    });
  });

  it('quem saiu pode voltar, e voltar é um opt-in novo', async () => {
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      await c.query(`select public.aceitar_marketing($1)`, [id]);
      const { rows: t } = await c.query(
        `select unsubscribe_token as tok from public.customers where id = $1`,
        [id],
      );
      await c.query(`select public.descadastrar_marketing($1)`, [t[0].tok]);
      expect(await noPublico(c, id)).toBe(false);

      await c.query(`select public.aceitar_marketing($1)`, [id]);
      expect(await noPublico(c, id)).toBe(true);

      // Voltar limpa a coluna de saída — e a saída continua registrada onde a
      // história de fato mora. Foi este teste que achou o empate de `now()`:
      // sair e voltar na mesma transação gravava a mesma data nas duas
      // colunas, e `opt_out < opt_in` deixava a pessoa fora sem avisar.
      const { rows } = await c.query(
        `select marketing_opt_out_at is null as limpou from public.customers where id = $1`,
        [id],
      );
      expect(rows[0].limpou).toBe(true);

      // Conta em vez de ordenar. Dentro de UMA transação, `created_at` é o
      // mesmo `now()` nas três linhas e o `id` é um uuid aleatório — não há
      // por onde ordenar, e `order by created_at, id` devolvia uma ordem
      // diferente a cada execução. Em produção os eventos são de dias
      // distintos e a ordem existe; aqui, o que dá para afirmar é quantos.
      const { rows: hist } = await c.query(
        `select action, count(*)::int as n from public.audit_log
          where entity_id = $1 group by action order by action`,
        [id],
      );
      expect(hist).toEqual([
        { action: 'marketing.opt_in', n: 2 },
        { action: 'marketing.opt_out', n: 1 },
      ]);
    });
  });

  it('token curto ou inexistente não descadastra ninguém', async () => {
    await comoPostgres(async (c) => {
      for (const tok of ['', 'abc', null, 'x'.repeat(24)]) {
        const { rows } = await c.query(
          `select public.descadastrar_marketing($1) as ok`,
          [tok],
        );
        expect(rows[0].ok).toBe(false);
      }
    });
  });
});

describe('a pré-visualização do WhatsApp não descadastra', () => {
  it('ler o dono do token deixa a pessoa no público', async () => {
    // O robô de link-preview abre o GET. Se isso desse baixa, a lista
    // esvaziaria sozinha e ninguém saberia por quê.
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      await c.query(`select public.aceitar_marketing($1)`, [id]);
      const { rows: t } = await c.query(
        `select unsubscribe_token as tok from public.customers where id = $1`,
        [id],
      );

      const { rows } = await c.query(`select * from public.dono_do_token($1)`, [t[0].tok]);
      expect(rows[0].restaurante).toBeTruthy();
      expect(rows[0].ja_saiu).toBe(false);

      expect(await noPublico(c, id)).toBe(true);
    });
  });

  it('`dono_do_token` é somente-leitura de fato', async () => {
    // Prova estrutural, não comportamental: a função é `stable`, e o Postgres
    // recusa escrita dentro dela. Um refactor que colocasse um UPDATE lá
    // quebraria aqui antes de chegar em produção.
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'dono_do_token'`,
      );
      expect(rows[0].provolatile).toBe('s');
    });
  });
});

describe('sem telefone não há campanha', () => {
  it('aceitou mas não deu o número: fora do público', async () => {
    await comoPostgres(async (c) => {
      const id = await novoCliente(c, { telefone: null });
      await c.query(`select public.aceitar_marketing($1)`, [id]);

      // O aceite existe — a pessoa disse sim.
      const { rows } = await c.query(
        `select marketing_opt_in_at is not null as aceitou
           from public.customers where id = $1`,
        [id],
      );
      expect(rows[0].aceitou).toBe(true);

      // Mas não há para onde mandar.
      expect(await noPublico(c, id)).toBe(false);
    });
  });
});

describe('o que a equipe pode ver', () => {
  it('a view não devolve telefone inteiro para a equipe', async () => {
    await como(DONO, async (c) => {
      const { rows } = await c.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'publico_de_marketing'`,
      );
      const colunas = rows.map((r) => r.column_name);
      expect(colunas).toContain('phone_mask');
      expect(colunas).not.toContain('phone');
    });
  });

  it('o token é segredo do cliente, não da casa', async () => {
    await como(DONO, async (c) => {
      await esperaFalhar(
        c,
        `select unsubscribe_token from public.customers limit 1`,
        [],
        /permission denied|não existe|does not exist/i,
      );
    });
  });

  it('o dono só enxerga o público do próprio restaurante', async () => {
    // Tudo numa transação só, e nada de `commit`: o `audit_log` é imutável de
    // propósito (§10), então teste que grava e depois limpa não tem como
    // terminar. Trocar de papel dentro da mesma transação dá o mesmo resultado
    // sem sujar o banco.
    await comoPostgres(async (c) => {
      const { rows: r } = await c.query(
        `insert into public.restaurants (name, slug, timezone)
         values ('Outra casa', 'outra-' || substr(gen_random_uuid()::text, 1, 8),
                 'America/Sao_Paulo')
         returning id`,
      );
      const { rows: cli } = await c.query(
        `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
         values ($1, $2, 'De fora', '11988887777', 'x') returning id`,
        [r[0].id, cpf()],
      );
      await c.query(`select public.aceitar_marketing($1)`, [cli[0].id]);

      // Existe, e está no público de quem é dele.
      expect(await noPublico(c, cli[0].id)).toBe(true);

      await viraStaff(c, DONO);
      const { rows } = await c.query(
        `select 1 from public.publico_de_marketing where id = $1`,
        [cli[0].id],
      );
      expect(rows).toHaveLength(0);
    });
  });
});

describe('a equipe tira, e não coloca', () => {
  it('dono remove alguém da lista', async () => {
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      await c.query(`select public.aceitar_marketing($1)`, [id]);
      expect(await noPublico(c, id)).toBe(true);

      await viraStaff(c, DONO);
      const { rows } = await c.query(`select public.remover_do_marketing($1) as ok`, [id]);
      expect(rows[0].ok).toBe(true);

      await c.query('reset role');
      expect(await noPublico(c, id)).toBe(false);
    });
  });

  it('garçom não remove', async () => {
    // A primeira versão pegava um cliente qualquer com `limit 1` e desistia se
    // não achasse nenhum. Como o seed não tem clientes, ela nunca chegou a
    // chamar a função: passava verde com a checagem de papel REMOVIDA. O
    // cliente agora é criado aqui, e o teste não tem como não exercitar.
    await comoPostgres(async (c) => {
      const id = await novoCliente(c);
      await c.query(`select public.aceitar_marketing($1)`, [id]);

      await viraStaff(c, GARCOM);
      await esperaFalhar(
        c,
        `select public.remover_do_marketing($1)`,
        [id],
        /dono ou gerente/,
      );

      // E continua na lista: a recusa não pode ser só a mensagem de erro.
      await c.query('reset role');
      expect(await noPublico(c, id)).toBe(true);
    });
  });

  it('não existe função de a equipe ACEITAR por alguém', async () => {
    // O caminho inverso não é um esquecimento: consentimento dado por outra
    // pessoa não é consentimento. Se alguém criar esse atalho, o teste cai.
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select p.proname, pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'app')
            and p.proname ~ 'marketing'`,
      );
      const nomes = rows.map((r) => r.proname).sort();
      expect(nomes).toEqual([
        'aceita_marketing',
        'aceitar_marketing',
        'descadastrar_marketing',
        'remover_do_marketing',
      ]);
    });
  });
});

describe('auditoria', () => {
  it('entrar e sair ficam registrados', async () => {
    const id = await comoPostgres(async (c) => {
      const x = await novoCliente(c);
      await c.query(`select public.aceitar_marketing($1)`, [x]);
      const { rows: t } = await c.query(
        `select unsubscribe_token as tok from public.customers where id = $1`,
        [x],
      );
      await c.query(`select public.descadastrar_marketing($1)`, [t[0].tok]);

      const { rows } = await c.query(
        `select action, count(*)::int as n from public.audit_log
          where entity_id = $1 group by action order by action`,
        [x],
      );
      expect(rows).toEqual([
        { action: 'marketing.opt_in', n: 1 },
        { action: 'marketing.opt_out', n: 1 },
      ]);
      return x;
    });
    expect(id).toBeTruthy();
  });
});
