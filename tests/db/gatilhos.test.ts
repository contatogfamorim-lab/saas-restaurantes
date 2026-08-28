/**
 * Gatilhos automáticos (migration 0056).
 *
 * O que precisa ser verdade:
 *
 *   1. gatilho nasce DESLIGADO — sistema que começa mandando mensagem sozinho
 *      mandou mensagem que ninguém pediu;
 *   2. a mesma pessoa nunca recebe duas vezes pelo mesmo EVENTO, nem que o job
 *      rode mil vezes;
 *   3. o teto por pessoa segura o exagero;
 *   4. quem não aceitou marketing não entra, nem por gatilho;
 *   5. gatilho NÃO tem caminho próprio de envio: ele cria campanha, e a
 *      campanha passa pela fila com todos os freios dela;
 *   6. demonstração não manda mensagem para ninguém;
 *   7. "sentimos sua falta" não vai para quem nunca apareceu.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const RESTAURANTE = '11111111-1111-4111-8111-111111111111';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000001';

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

/** WhatsApp ligado — sem isso nenhum gatilho roda, e é assim que deve ser. */
async function casaPronta(c: Client) {
  await c.query(
    `update public.restaurants set evolution_instance_name = 'teste' where id = $1`,
    [RESTAURANTE],
  );
}

async function clienteAceito(c: Client, nome = 'Joana'): Promise<string> {
  const { rows } = await c.query(
    `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
     values ($1, $2, $3, '11999990000', 'x') returning id`,
    [RESTAURANTE, cpf(), nome],
  );
  await c.query(`select public.aceitar_marketing($1)`, [rows[0].id]);
  return rows[0].id;
}

async function ligaGatilho(c: Client, kind: string, dias = 60) {
  await c.query(
    `insert into public.message_triggers (restaurant_id, kind, ativo, corpo, dias)
     values ($1, $2, true, app.corpo_padrao_do_gatilho($2), $3)
     on conflict (restaurant_id, kind) do update set ativo = true, dias = $3`,
    [RESTAURANTE, kind, dias],
  );
}

/** Um crédito que já saiu da carência agora mesmo. */
async function creditoLiberado(c: Client, cliente: string, valor = 2000) {
  await c.query(
    `insert into public.customer_cashback_ledger
       (restaurant_id, customer_id, kind, amount_cents, available_at, base_cents, pct)
     values ($1, $2, 'credito', $3, now() - interval '1 hour', $3 * 20, 5)`,
    [RESTAURANTE, cliente, valor],
  );
}

/**
 * Empurra as campanhas de gatilho para ONTEM.
 *
 * Existe porque duas sabotagens passaram sem ser notadas: com tudo acontecendo
 * no mesmo dia, `campaign_targets_uma_vez_idx` — o índice (campanha, cliente)
 * da 0050 — bloqueia a segunda inserção sozinho, e mascara tanto a
 * idempotência por evento quanto o teto por pessoa.
 *
 * `campanha_do_gatilho` cria uma campanha por dia. Envelhecer a de hoje faz a
 * próxima rodada criar OUTRA — que é o cenário em que os dois guardas de fato
 * precisam trabalhar.
 */
async function passaODia(c: Client) {
  await c.query(
    `update public.message_campaigns set created_at = created_at - interval '1 day'
      where trigger_kind is not null`,
  );
}

async function naFila(c: Client, cliente: string): Promise<number> {
  const { rows } = await c.query(
    `select count(*)::int as n from public.message_campaign_targets
      where customer_id = $1 and trigger_ref is not null`,
    [cliente],
  );
  return rows[0].n;
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
});
afterAll(async () => {
  await pool.end();
});

describe('nasce desligado', () => {
  it('o padrão da coluna é false', async () => {
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select column_default from information_schema.columns
          where table_name = 'message_triggers' and column_name = 'ativo'`,
      );
      expect(rows[0].column_default).toMatch(/false/);
    });
  });

  it('gatilho desligado não enfileira ninguém', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      const cli = await clienteAceito(c);
      await creditoLiberado(c, cli);
      await c.query(
        `insert into public.message_triggers (restaurant_id, kind, ativo, corpo)
         values ($1, 'liberou', false, app.corpo_padrao_do_gatilho('liberou'))`,
        [RESTAURANTE],
      );

      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(0);
    });
  });
});

describe('cashback liberou', () => {
  it('avisa quem acabou de sair da carência', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'liberou');
      const cli = await clienteAceito(c);
      await creditoLiberado(c, cli, 2500);

      const { rows } = await c.query(`select public.rodar_gatilhos() as r`);
      expect(rows[0].r.liberou).toBe(1);
      expect(await naFila(c, cli)).toBe(1);

      // A mensagem é a do gatilho, com nome e saldo trocados e o link colado.
      const { rows: m } = await c.query(
        `select message from public.message_campaign_targets where customer_id = $1`,
        [cli],
      );
      expect(m[0].message).toContain('R$ 25,00');
      expect(m[0].message).toMatch(/Para não receber mais/);
    });
  });

  it('rodar dez vezes, em dias diferentes, não avisa dez vezes', async () => {
    // O MESMO crédito continua dentro da janela de 2 dias amanhã. Sem a
    // referência do evento, a pessoa receberia o aviso de novo — em uma
    // campanha nova, que o índice por campanha não alcança.
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'liberou');
      const cli = await clienteAceito(c);
      await creditoLiberado(c, cli);

      for (let i = 0; i < 10; i++) {
        await c.query(`select public.rodar_gatilhos()`);
        await passaODia(c);
      }
      expect(await naFila(c, cli)).toBe(1);
    });
  });

  it('crédito ainda em carência não dispara nada', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'liberou');
      const cli = await clienteAceito(c);
      await c.query(
        `insert into public.customer_cashback_ledger
           (restaurant_id, customer_id, kind, amount_cents, available_at, base_cents, pct)
         values ($1, $2, 'credito', 2000, now() + interval '20 hours', 40000, 5)`,
        [RESTAURANTE, cli],
      );

      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(0);
    });
  });
});

describe('o consentimento vale para gatilho também', () => {
  it('quem não aceitou não entra na fila', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'liberou');
      const { rows } = await c.query(
        `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
         values ($1, $2, 'Nunca Aceitou', '11988887777', 'x') returning id`,
        [RESTAURANTE, cpf()],
      );
      await creditoLiberado(c, rows[0].id);

      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, rows[0].id)).toBe(0);
    });
  });

  it('quem saiu depois de entrar na fila é pulado no envio', async () => {
    // O gatilho enfileira, a pessoa sai, e a fila reconfere. É a mesma guarda
    // da 0050 valendo para mensagem automática.
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'liberou');
      const cli = await clienteAceito(c);
      await creditoLiberado(c, cli);
      await c.query(`select public.rodar_gatilhos()`);

      await c.query(
        `update public.customers set marketing_opt_out_at = now() where id = $1`,
        [cli],
      );
      const { rows } = await c.query(`select * from public.reservar_proximo_envio()`);
      expect(rows).toHaveLength(0);

      const { rows: alvo } = await c.query(
        `select status, motivo from public.message_campaign_targets where customer_id = $1`,
        [cli],
      );
      expect(alvo[0].status).toBe('skipped');
      expect(alvo[0].motivo).toMatch(/saiu da lista/);
    });
  });
});

describe('o teto por pessoa', () => {
  it('segura depois de N automáticas no mês', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await c.query(
        `update public.restaurants set marketing_max_por_cliente_mes = 1 where id = $1`,
        [RESTAURANTE],
      );
      await ligaGatilho(c, 'liberou');
      const cli = await clienteAceito(c);

      await creditoLiberado(c, cli, 1000);
      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(1);

      // A primeira precisa ter SAÍDO para contar no teto.
      await c.query(
        `update public.message_campaign_targets set status = 'sent', sent_at = now()
          where customer_id = $1`,
        [cli],
      );

      // O dia vira, senão o índice (campanha, cliente) da 0050 bloqueia
      // sozinho e o teto não chega a ser exercitado.
      await passaODia(c);

      // Um crédito novo, um evento novo, campanha nova — e o teto segura.
      await creditoLiberado(c, cli, 3000);
      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(1);
    });
  });
});

describe('sentimos sua falta', () => {
  it('não vai para quem nunca apareceu', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'sumido', 30);
      const cli = await clienteAceito(c, 'Nunca Veio');

      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(0);
    });
  });

  it('vai para quem veio e sumiu', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'sumido', 30);
      const cli = await clienteAceito(c, 'Sumida');

      const { rows: mesa } = await c.query(
        `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
        [RESTAURANTE],
      );
      const { rows: s } = await c.query(
        `insert into public.table_sessions
           (restaurant_id, table_id, guest_count, status, closed_at)
         values ($1, $2, 1, 'closed', now()) returning id`,
        [RESTAURANTE, mesa[0].id],
      );
      await c.query(
        `insert into public.session_guests
           (restaurant_id, session_id, display_name, customer_id, joined_at)
         values ($1, $2, 'Sumida', $3, now() - interval '90 days')`,
        [RESTAURANTE, s[0].id, cli],
      );

      const { rows } = await c.query(`select public.rodar_gatilhos() as r`);
      expect(rows[0].r.sumido).toBe(1);
    });
  });

  it('quem voltou ontem não recebe', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'sumido', 30);
      const cli = await clienteAceito(c, 'Voltou');

      const { rows: mesa } = await c.query(
        `select id from public.restaurant_tables where restaurant_id = $1 limit 1`,
        [RESTAURANTE],
      );
      const { rows: s } = await c.query(
        `insert into public.table_sessions
           (restaurant_id, table_id, guest_count, status, closed_at)
         values ($1, $2, 1, 'closed', now()) returning id`,
        [RESTAURANTE, mesa[0].id],
      );
      await c.query(
        `insert into public.session_guests
           (restaurant_id, session_id, display_name, customer_id, joined_at)
         values ($1, $2, 'Voltou', $3, now() - interval '1 day')`,
        [RESTAURANTE, s[0].id, cli],
      );

      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(0);
    });
  });
});

describe('vai expirar', () => {
  it('avisa quem tem saldo caducando na semana', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await c.query(
        `update public.restaurants set cashback_validade_dias = 90 where id = $1`,
        [RESTAURANTE],
      );
      await ligaGatilho(c, 'vai_expirar');
      const cli = await clienteAceito(c);

      // Crédito de 85 dias atrás: caduca em 5.
      await c.query(
        `insert into public.customer_cashback_ledger
           (restaurant_id, customer_id, kind, amount_cents, available_at,
            base_cents, pct, created_at)
         values ($1, $2, 'credito', 4000, now() - interval '85 days', 80000, 5,
                 now() - interval '85 days')`,
        [RESTAURANTE, cli],
      );

      const { rows } = await c.query(`select public.rodar_gatilhos() as r`);
      expect(rows[0].r.vai_expirar).toBe(1);
    });
  });

  it('sem validade configurada, ninguém é avisado', async () => {
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await c.query(
        `update public.restaurants set cashback_validade_dias = 0 where id = $1`,
        [RESTAURANTE],
      );
      await ligaGatilho(c, 'vai_expirar');
      const cli = await clienteAceito(c);
      await c.query(
        `insert into public.customer_cashback_ledger
           (restaurant_id, customer_id, kind, amount_cents, available_at,
            base_cents, pct, created_at)
         values ($1, $2, 'credito', 4000, now() - interval '300 days', 80000, 5,
                 now() - interval '300 days')`,
        [RESTAURANTE, cli],
      );

      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(0);
    });
  });
});

describe('as portas fechadas', () => {
  it('sem WhatsApp conectado, nenhum gatilho roda', async () => {
    await comoPostgres(async (c) => {
      await c.query(
        `update public.restaurants set evolution_instance_name = null where id = $1`,
        [RESTAURANTE],
      );
      await ligaGatilho(c, 'liberou');
      const cli = await clienteAceito(c);
      await creditoLiberado(c, cli);

      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(0);
    });
  });

  it('demonstração não manda mensagem para ninguém', async () => {
    // O restaurante some em 3 horas; o WhatsApp de quem recebeu, não.
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await c.query(
        `update public.restaurants set expires_at = now() + interval '3 hours' where id = $1`,
        [RESTAURANTE],
      );
      await ligaGatilho(c, 'liberou');
      const cli = await clienteAceito(c);
      await creditoLiberado(c, cli);

      await c.query(`select public.rodar_gatilhos()`);
      expect(await naFila(c, cli)).toBe(0);
    });
  });

  it('a equipe não executa rodar_gatilhos', async () => {
    await comoPostgres(async (c) => {
      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [DONO],
      );
      await c.query('set local role authenticated');
      await c.query('savepoint t');
      try {
        await c.query(`select public.rodar_gatilhos()`);
        await c.query('rollback to savepoint t');
        throw new Error('a equipe executou o motor dos gatilhos');
      } catch (e) {
        await c.query('rollback to savepoint t').catch(() => {});
        expect(String((e as Error).message)).toMatch(/permission denied/i);
      }
    });
  });

  it('um gatilho por tipo por casa', async () => {
    await comoPostgres(async (c) => {
      await c.query(
        `insert into public.message_triggers (restaurant_id, kind, corpo)
         values ($1, 'liberou', 'primeiro texto aqui')`,
        [RESTAURANTE],
      );
      await c.query('savepoint t');
      try {
        await c.query(
          `insert into public.message_triggers (restaurant_id, kind, corpo)
           values ($1, 'liberou', 'segundo texto aqui')`,
          [RESTAURANTE],
        );
        await c.query('rollback to savepoint t');
        throw new Error('aceitou dois gatilhos do mesmo tipo');
      } catch (e) {
        await c.query('rollback to savepoint t').catch(() => {});
        expect(String((e as Error).message)).toMatch(/um_por_tipo|duplicate key/i);
      }
    });
  });

  it('mil pessoas viram UMA campanha, não mil', async () => {
    // A fila escolhe uma campanha por casa por rodada. Mil campanhas fariam as
    // 999 restantes esperarem indefinidamente.
    await comoPostgres(async (c) => {
      await casaPronta(c);
      await ligaGatilho(c, 'liberou');
      for (let i = 0; i < 5; i++) {
        const cli = await clienteAceito(c, `Cliente ${i}`);
        await creditoLiberado(c, cli);
      }
      await c.query(`select public.rodar_gatilhos()`);

      const { rows } = await c.query(
        `select count(*)::int as n from public.message_campaigns
          where trigger_kind = 'liberou'`,
      );
      expect(rows[0].n).toBe(1);

      const { rows: alvos } = await c.query(
        `select count(*)::int as n from public.message_campaign_targets t
           join public.message_campaigns c on c.id = t.campaign_id
          where c.trigger_kind = 'liberou'`,
      );
      expect(alvos[0].n).toBe(5);
    });
  });
});
