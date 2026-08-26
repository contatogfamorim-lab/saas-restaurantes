/**
 * Conta do cliente e cashback (migrations 0037–0039).
 *
 * O que precisa ser verdade:
 *
 *   1. o abatimento NUNCA passa de 30% da conta. É a regra inteira, e dela
 *      decorre que o saldo só é gasto por completo numa compra 3,333…× maior —
 *      100/30. A fronteira exata é testada no centavo;
 *   2. o crédito não vale antes de 24 horas;
 *   3. o valor do resgate NÃO vem do cliente: o navegador manda "quero usar", e
 *      quem calcula é o banco (§10.1);
 *   4. um cookie válido não gasta saldo na mesa de outra pessoa (§10.4);
 *   5. senha e CPF não saem da tabela por nenhum GRANT;
 *   6. a casa nunca credita a mais: piso, não arredondamento.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE = '11111111-1111-4111-8111-111111111111';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000001';
const GARCOM_A = 'aaaaaaaa-0000-4000-8000-000000000002';

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

/** Uma comanda aberta com um item de `valorCents`, e um cliente sentado nela. */
async function montarMesa(
  c: Client,
  cliente: string,
  valorCents: number,
): Promise<{ sessao: string; guest: string }> {
  const { rows: mesas } = await c.query(
    `select id from public.restaurant_tables
      where restaurant_id = $1 and id not in (
        select table_id from public.table_sessions
         where restaurant_id = $1 and status = 'open')
      limit 1`,
    [RESTAURANTE],
  );
  const { rows: prods } = await c.query(
    `select id from public.products where restaurant_id = $1 and price_cents > 0 limit 1`,
    [RESTAURANTE],
  );

  const { rows: s } = await c.query(
    `insert into public.table_sessions (restaurant_id, table_id, guest_count)
     values ($1, $2, 1) returning id`,
    [RESTAURANTE, mesas[0].id],
  );
  const { rows: g } = await c.query(
    `insert into public.session_guests (restaurant_id, session_id, display_name, customer_id)
     values ($1, $2, 'Cliente', $3) returning id`,
    [RESTAURANTE, s[0].id, cliente],
  );
  const { rows: o } = await c.query(
    `insert into public.orders (restaurant_id, session_id, guest_id, source,
                                idempotency_key, status, approved_by, approved_at)
     values ($1, $2, $3, 'guest', gen_random_uuid()::text, 'approved', $4, now())
     returning id`,
    [RESTAURANTE, s[0].id, g[0].id, DONO],
  );

  // O item nasce `pending` por trigger (§16) e sobe pelos mesmos degraus que a
  // cozinha daria. Escrever 'delivered' direto é recusado, e deve ser.
  const { rows: i } = await c.query(
    `insert into public.order_items
       (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
        total_price_cents, station)
     values ($1, $2, $3, $4, 1, $5, $5, 'cozinha') returning id`,
    [RESTAURANTE, o[0].id, prods[0].id, g[0].id, valorCents],
  );
  for (const st of ['queued', 'preparing', 'ready', 'delivered']) {
    await c.query(`update public.order_items set status = $1 where id = $2`, [st, i[0].id]);
  }

  return { sessao: s[0].id, guest: g[0].id };
}

async function comSaldo(c: Client, cliente: string, cents: number) {
  await c.query(
    `insert into public.customer_cashback_ledger
       (restaurant_id, customer_id, kind, amount_cents, available_at)
     values ($1, $2, 'credito', $3, now() - interval '1 day')`,
    [RESTAURANTE, cliente, cents],
  );
}

async function novoCliente(c: Client, cpf: string): Promise<string> {
  const { rows } = await c.query(
    `select public.cadastrar_cliente($1, $2, 'Cliente Teste', 'uma frase comprida') as id`,
    [RESTAURANTE, cpf],
  );
  return rows[0].id;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('o teto de 30%', () => {
  it('a fronteira do saldo inteiro cai no centavo exato', async () => {
    // R$ 20,00 de saldo. 2000 / 0,30 = 6666,67 — então R$ 66,66 deixa um
    // centavo para trás e R$ 66,67 libera tudo. É a regra "compra 3,333× maior"
    // escrita do outro lado, e é onde um erro de arredondamento apareceria.
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10, service_fee_pct = 0
                      where id = $1`, [RESTAURANTE]);
      const cli = await novoCliente(c, '12345678909');

      const casos: [number, number][] = [
        [3000, 900],   // 30% de R$ 30,00
        [6000, 1800],
        [6666, 1999],  // um centavo aquém
        [6667, 2000],  // libera o saldo inteiro
        [20000, 2000], // teto é o saldo, não os 30%
      ];

      for (const [conta, esperado] of casos) {
        await comSaldo(c, cli, 2000);
        const { sessao } = await montarMesa(c, cli, conta);
        const { rows } = await c.query(
          `select public.resgatar_cashback($1, $2) as r`, [sessao, cli],
        );
        expect(rows[0].r.aplicado_cents, `conta de ${conta}`).toBe(esperado);

        await c.query(`select public.desfazer_resgate($1, $2)`, [sessao, cli]);
        await c.query(
          `delete from public.customer_cashback_ledger where customer_id = $1`, [cli],
        );
        await c.query(
          `update public.table_sessions set status='closed', closed_at=now() where id=$1`,
          [sessao],
        );
      }
    });
  });

  it('o valor não vem do cliente: chamar de novo recalcula, não soma', async () => {
    // Dois toques no botão dariam dois abatimentos, e o segundo passaria do teto
    // que o primeiro respeitou. A função apaga o resgate anterior antes de
    // recalcular — por isso a terceira chamada dá o mesmo que a primeira.
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10, service_fee_pct = 0
                      where id = $1`, [RESTAURANTE]);
      const cli = await novoCliente(c, '12345678909');
      await comSaldo(c, cli, 2000);
      const { sessao } = await montarMesa(c, cli, 10000);

      for (let i = 0; i < 3; i++) {
        const { rows } = await c.query(
          `select public.resgatar_cashback($1, $2) as r`, [sessao, cli],
        );
        expect(rows[0].r.aplicado_cents).toBe(2000);
      }

      const { rows } = await c.query(
        `select count(*)::int as linhas, coalesce(sum(amount_cents),0)::int as total
           from public.session_adjustments
          where session_id = $1 and type = 'cashback'`,
        [sessao],
      );
      expect(rows[0].linhas).toBe(1);
      expect(rows[0].total).toBe(2000);
      expect((await c.query(`select app.saldo_disponivel($1) as s`, [cli])).rows[0].s).toBe(0);
    });
  });

  it('a conta desce exatamente o valor resgatado', async () => {
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10, service_fee_pct = 10
                      where id = $1`, [RESTAURANTE]);
      const cli = await novoCliente(c, '12345678909');
      await comSaldo(c, cli, 2000);
      const { sessao } = await montarMesa(c, cli, 10000);

      const antes = (await c.query(
        `select total_cents from public.session_totals where session_id = $1`, [sessao],
      )).rows[0].total_cents;

      await c.query(`select public.resgatar_cashback($1, $2)`, [sessao, cli]);

      const { rows } = await c.query(
        `select total_cents, cashback_cents, discount_cents
           from public.session_totals where session_id = $1`, [sessao],
      );
      expect(rows[0].cashback_cents).toBe(2000);
      expect(rows[0].total_cents).toBe(antes - 2000);
      // O resgate NÃO é desconto concedido: a casa não deu nada, o cliente
      // gastou o que já era dele.
      expect(rows[0].discount_cents).toBe(0);
    });
  });
});

// ===========================================================================
describe('a carência de 24 horas', () => {
  it('o crédito nasce indisponível e aparece depois', async () => {
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10, service_fee_pct = 10
                      where id = $1`, [RESTAURANTE]);
      const cli = await novoCliente(c, '12345678909');
      const { sessao } = await montarMesa(c, cli, 20000);

      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role','authenticated')::text, true)`,
        [DONO],
      );
      const total = (await c.query(
        `select total_cents from public.session_totals where session_id = $1`, [sessao],
      )).rows[0].total_cents;
      await c.query(`select public.register_payment($1,'pix',$2,'pg1')`, [sessao, total]);

      // 10% dos ITENS (R$ 200,00), não do total com taxa — a taxa é da equipe.
      expect((await c.query(`select app.saldo_disponivel($1) as s`, [cli])).rows[0].s).toBe(0);
      expect((await c.query(`select app.saldo_em_carencia($1) as s`, [cli])).rows[0].s).toBe(2000);

      await c.query(
        `update public.customer_cashback_ledger set available_at = now() - interval '1 minute'
          where customer_id = $1`, [cli],
      );
      expect((await c.query(`select app.saldo_disponivel($1) as s`, [cli])).rows[0].s).toBe(2000);
    });
  });

  it('a base do crédito exclui a taxa de serviço e o que foi abatido', async () => {
    // Creditar sobre o total com taxa faria a casa devolver percentual sobre
    // gorjeta da equipe. Creditar sobre o subtotal cheio, mesmo tendo abatido
    // cashback, faria devolver sobre dinheiro que não entrou.
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10, service_fee_pct = 10
                      where id = $1`, [RESTAURANTE]);
      const cli = await novoCliente(c, '12345678909');
      await comSaldo(c, cli, 2000);
      const { sessao } = await montarMesa(c, cli, 10000);

      await c.query(`select public.resgatar_cashback($1, $2)`, [sessao, cli]);

      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role','authenticated')::text, true)`,
        [DONO],
      );
      const total = (await c.query(
        `select total_cents from public.session_totals where session_id = $1`, [sessao],
      )).rows[0].total_cents;
      await c.query(`select public.register_payment($1,'pix',$2,'pg2')`, [sessao, total]);

      // itens 10000 − resgate 2000 = base 8000 → 10% = 800
      //
      // Filtrado por SESSÃO, e não só por cliente: `comSaldo` também insere um
      // crédito, e sem isto a consulta devolvia a linha semeada — que tem
      // `base_cents` nulo e fazia o teste falhar contra si mesmo.
      const { rows } = await c.query(
        `select amount_cents, base_cents from public.customer_cashback_ledger
          where customer_id = $1 and kind = 'credito' and session_id = $2`,
        [cli, sessao],
      );
      expect(rows.length, 'o crédito precisa existir').toBe(1);
      expect(rows[0].base_cents).toBe(8000);
      expect(rows[0].amount_cents).toBe(800);
    });
  });

  it('a mesma comanda não credita duas vezes', async () => {
    // `creditar_cashback` é chamável por `authenticated` — tem de ser, porque
    // `register_payment` roda com o papel de quem está no caixa, e o que é
    // executável é chamável direto. Sem esta garantia, repetir a chamada tiraria
    // dinheiro do bolso da casa a cada repetição.
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10, service_fee_pct = 0
                      where id = $1`, [RESTAURANTE]);
      const cli = await novoCliente(c, '12345678909');
      const { sessao } = await montarMesa(c, cli, 10000);

      const primeira = await c.query(`select app.creditar_cashback($1) as v`, [sessao]);
      expect(primeira.rows[0].v).toBe(1000);

      for (let i = 0; i < 3; i++) {
        const r = await c.query(`select app.creditar_cashback($1) as v`, [sessao]);
        expect(r.rows[0].v).toBe(0);
      }

      const { rows } = await c.query(
        `select count(*)::int as n, coalesce(sum(amount_cents),0)::int as total
           from public.customer_cashback_ledger
          where session_id = $1 and kind = 'credito'`,
        [sessao],
      );
      expect(rows[0].n).toBe(1);
      expect(rows[0].total).toBe(1000);
    });
  });

  it('e o índice único impede a corrida, não só o `if`', async () => {
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10 where id = $1`, [RESTAURANTE]);
      const cli = await novoCliente(c, '12345678909');
      const { sessao } = await montarMesa(c, cli, 10000);
      await c.query(`select app.creditar_cashback($1)`, [sessao]);

      // Escrita direta, driblando o `if` da função: o armazenamento recusa.
      await esperaFalhar(
        c,
        `insert into public.customer_cashback_ledger
           (restaurant_id, customer_id, session_id, kind, amount_cents)
         values ($1, $2, $3, 'credito', 999)`,
        [RESTAURANTE, cli, sessao],
        /cashback_um_credito_por_sessao/i,
      );
    });
  });

  it('sem cliente na mesa, ninguém ganha nada', async () => {
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10 where id = $1`, [RESTAURANTE]);
      const antes = (await c.query(
        `select count(*)::int as n from public.customer_cashback_ledger`,
      )).rows[0].n;

      const { rows: mesas } = await c.query(
        `select id from public.restaurant_tables where restaurant_id = $1
           and id not in (select table_id from public.table_sessions
                           where restaurant_id = $1 and status='open') limit 1`,
        [RESTAURANTE],
      );
      const { rows: s } = await c.query(
        `insert into public.table_sessions (restaurant_id, table_id, guest_count)
         values ($1,$2,1) returning id`, [RESTAURANTE, mesas[0].id],
      );
      // visitante: sem customer_id
      await c.query(
        `insert into public.session_guests (restaurant_id, session_id, display_name)
         values ($1,$2,'Visitante')`, [RESTAURANTE, s[0].id],
      );

      const { rows } = await c.query(`select app.creditar_cashback($1) as v`, [s[0].id]);
      expect(rows[0].v).toBe(0);
      expect((await c.query(`select count(*)::int as n from public.customer_cashback_ledger`))
        .rows[0].n).toBe(antes);
    });
  });

  it('com cashback_pct em zero, o recurso simplesmente não existe', async () => {
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 0 where id = $1`, [RESTAURANTE]);
      const cli = await novoCliente(c, '12345678909');
      const { sessao } = await montarMesa(c, cli, 20000);
      const { rows } = await c.query(`select app.creditar_cashback($1) as v`, [sessao]);
      expect(rows[0].v).toBe(0);
    });
  });
});

// ===========================================================================
describe('as portas fechadas', () => {
  it('um cliente não gasta saldo na mesa de outra pessoa', async () => {
    // O IDOR que a §10.4 fecha para `session_id`, aplicado ao saldo: cookie
    // válido, id de sessão descoberto, e a conta de outra mesa abatida com o
    // dinheiro de quem nem está lá.
    await comoPostgres(async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 10 where id = $1`, [RESTAURANTE]);
      const intruso = await novoCliente(c, '12345678909');
      const vitima = await novoCliente(c, '98765432100');
      await comSaldo(c, intruso, 5000);

      const { sessao } = await montarMesa(c, vitima, 20000);

      await esperaFalhar(
        c,
        `select public.resgatar_cashback($1, $2)`,
        [sessao, intruso],
        /não está nesta mesa/i,
      );
    });
  });

  it('não dá para resgatar em comanda já fechada', async () => {
    await comoPostgres(async (c) => {
      const cli = await novoCliente(c, '12345678909');
      await comSaldo(c, cli, 5000);
      const { sessao } = await montarMesa(c, cli, 20000);
      await c.query(
        `update public.table_sessions set status='closed', closed_at=now() where id=$1`, [sessao],
      );
      await esperaFalhar(
        c, `select public.resgatar_cashback($1, $2)`, [sessao, cli], /não está aberta/i,
      );
    });
  });

  it('a equipe NÃO lê CPF nem hash de senha, por GRANT nenhum', async () => {
    // Espelha o tratamento que o telefone tem desde a 0009: a coluna crua fica
    // fora do GRANT, e o que existe para a equipe é a máscara.
    await como(DONO, async (c) => {
      for (const coluna of ['cpf', 'password_hash', 'phone']) {
        await esperaFalhar(
          c,
          `select ${coluna} from public.customers limit 1`,
          [],
          /permission denied|not exist/i,
        );
      }
      // e a máscara abre
      const { rows } = await c.query(`select cpf_mask from public.customers limit 1`);
      expect(rows).toBeDefined();
    });
  });

  it('o anônimo não toca na tabela de clientes', async () => {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`set local role anon`);
      await esperaFalhar(
        client, `select id from public.customers limit 1`, [], /permission denied/i,
      );
      await esperaFalhar(
        client, `select id from public.customer_cashback_ledger limit 1`, [], /permission denied/i,
      );
    } finally {
      await client.query('rollback').catch(() => {});
      await client.end();
    }
  });

  it('senha curta e CPF inválido são recusados na entrada', async () => {
    await comoPostgres(async (c) => {
      await esperaFalhar(
        c,
        `select public.cadastrar_cliente($1,'123','Fulano','uma frase comprida')`,
        [RESTAURANTE],
        /11 dígitos/i,
      );
      await esperaFalhar(
        c,
        `select public.cadastrar_cliente($1,'12345678909','Fulano','curta')`,
        [RESTAURANTE],
        /8 caracteres/i,
      );
    });
  });

  it('o mesmo CPF não abre duas contas na mesma casa', async () => {
    await comoPostgres(async (c) => {
      await novoCliente(c, '12345678909');
      await esperaFalhar(
        c,
        `select public.cadastrar_cliente($1,'123.456.789-09','Outro','uma frase comprida')`,
        [RESTAURANTE],
        /já existe uma conta/i,
      );
    });
  });

  it('desconto CONCEDIDO continua exigindo um responsável', async () => {
    // A 0037 tirou o `not null` de `created_by` para o resgate poder existir sem
    // funcionário. Este teste é o que impede a exceção de vazar para os outros
    // tipos — desconto sem nome atrás é desconto que a auditoria não explica.
    await comoPostgres(async (c) => {
      const cli = await novoCliente(c, '12345678909');
      const { sessao } = await montarMesa(c, cli, 10000);
      await esperaFalhar(
        c,
        `insert into public.session_adjustments
           (restaurant_id, session_id, type, amount_cents, reason)
         values ($1, $2, 'discount', 500, 'sem dono')`,
        [RESTAURANTE, sessao],
        /ajuste_da_equipe_tem_responsavel/i,
      );
    });
  });
});

// ===========================================================================
describe('configurações da casa (0041)', () => {
  it('o dono liga e desliga o cashback, e fica registrado', async () => {
    await como(DONO, async (c) => {
      await c.query(`update public.restaurants set cashback_pct = 0 where id = $1`, [RESTAURANTE]);

      await c.query(`select public.atualizar_configuracoes('{"cashback": 7.5}'::jsonb)`);
      expect((await c.query(
        `select cashback_pct::float8 as v from public.restaurants where id = $1`, [RESTAURANTE],
      )).rows[0].v).toBe(7.5);

      // A auditoria guarda o antes E o depois — é o que responde "quem mudou a
      // taxa?" no dia em que alguém perguntar.
      const { rows } = await c.query(
        `select before, after from public.audit_log
          where restaurant_id = $1 and action = 'restaurant.settings_changed'
          order by created_at desc limit 1`,
        [RESTAURANTE],
      );
      expect(Number(rows[0].before.cashback)).toBe(0);
      expect(Number(rows[0].after.cashback)).toBe(7.5);

      await c.query(`select public.atualizar_configuracoes('{"cashback": 0}'::jsonb)`);
      expect((await c.query(
        `select cashback_pct::float8 as v from public.restaurants where id = $1`, [RESTAURANTE],
      )).rows[0].v).toBe(0);
    });
  });

  it('desligar o cashback NÃO apaga o saldo já acumulado', async () => {
    // A tela promete isso com todas as letras. Se o saldo sumisse, a casa
    // estaria confiscando dinheiro que já tinha prometido.
    await comoPostgres(async (c) => {
      const cli = await novoCliente(c, '12345678909');
      await comSaldo(c, cli, 3000);
      await c.query(`update public.restaurants set cashback_pct = 0 where id = $1`, [RESTAURANTE]);
      expect((await c.query(`select app.saldo_disponivel($1) as s`, [cli])).rows[0].s).toBe(3000);
    });
  });

  it('campo ausente é campo NÃO alterado', async () => {
    // A tela pode mandar só o que mexeu. Uma tela futura que esqueça um campo
    // não pode zerá-lo por omissão.
    await como(DONO, async (c) => {
      await c.query(`select public.atualizar_configuracoes(
        '{"cashback": 9, "taxa_servico": 12}'::jsonb)`);
      await c.query(`select public.atualizar_configuracoes('{"nome": "Outro Nome"}'::jsonb)`);

      const { rows } = await c.query(
        `select name, cashback_pct::float8 as cb, service_fee_pct::float8 as taxa
           from public.restaurants where id = $1`, [RESTAURANTE],
      );
      expect(rows[0].name).toBe('Outro Nome');
      expect(rows[0].cb).toBe(9);
      expect(rows[0].taxa).toBe(12);
    });
  });

  it('os tetos são apertados no servidor: 200% vira 20%', async () => {
    await como(DONO, async (c) => {
      await c.query(`select public.atualizar_configuracoes(
        '{"cashback": 200, "taxa_servico": 900}'::jsonb)`);
      const { rows } = await c.query(
        `select cashback_pct::float8 as cb, service_fee_pct::float8 as taxa
           from public.restaurants where id = $1`, [RESTAURANTE],
      );
      expect(rows[0].cb).toBe(20);
      expect(rows[0].taxa).toBe(30);
    });
  });

  it('quem não administra não muda configuração nenhuma', async () => {
    await como(GARCOM_A, async (c) => {
      await esperaFalhar(
        c,
        `select public.atualizar_configuracoes('{"cashback": 20}'::jsonb)`,
        [],
        /administra muda as configurações/i,
      );
    });
  });

  it('cor inválida é ignorada, e não quebra a casca das telas', async () => {
    await como(DONO, async (c) => {
      const antes = (await c.query(
        `select brand_color from public.restaurants where id = $1`, [RESTAURANTE],
      )).rows[0].brand_color;

      await c.query(`select public.atualizar_configuracoes('{"cor": "laranja"}'::jsonb)`);

      expect((await c.query(
        `select brand_color from public.restaurants where id = $1`, [RESTAURANTE],
      )).rows[0].brand_color).toBe(antes);
    });
  });
});
