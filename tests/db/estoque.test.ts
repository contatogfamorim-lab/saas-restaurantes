/**
 * Estoque e ficha técnica (migration 0052).
 *
 * O que precisa ser verdade:
 *
 *   1. a baixa acontece em `queued`, uma vez só, mesmo se a transição repetir;
 *   2. a baixa NUNCA impede o pedido — falta de estoque vira saldo negativo,
 *      não recusa na cara de um cliente que já pediu;
 *   3. quantidade é inteira em milésimos: a soma de trezentas porções de 150 g
 *      tem que fechar no grama;
 *   4. o prato sai do ar quando o que sobrou não faz mais UMA porção — e não
 *      quando zera, que já é tarde;
 *   5. o sistema DESLIGA o prato, e nunca religa sozinho;
 *   6. item recusado em `queued` devolve; de `preparing` em diante, não;
 *   7. o saldo só muda por movimento registrado — não há UPDATE direto;
 *   8. garçom não mexe no estoque.
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

let n = 0;
async function novoInsumo(
  c: Client,
  quantidade: bigint | number,
  opts: { unidade?: string; minimo?: number; custo?: number } = {},
): Promise<string> {
  const { rows } = await c.query(
    `insert into public.ingredients
       (restaurant_id, name, unit, quantidade, minimo, custo_por_mil_cents)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      RESTAURANTE,
      `Insumo ${++n} ${Math.random().toString(36).slice(2, 7)}`,
      opts.unidade ?? 'g',
      String(quantidade),
      opts.minimo ?? 0,
      opts.custo ?? 0,
    ],
  );
  return rows[0].id;
}

/** Um produto próprio, para não sujar a ficha técnica de outro teste. */
async function novoProduto(c: Client, precoCents = 3000): Promise<string> {
  const { rows: cat } = await c.query(
    `select id from public.categories where restaurant_id = $1 limit 1`,
    [RESTAURANTE],
  );
  const { rows } = await c.query(
    `insert into public.products
       (restaurant_id, category_id, name, price_cents, is_available)
     values ($1, $2, $3, $4, true) returning id`,
    [RESTAURANTE, cat[0].id, `Prato ${++n} ${Math.random().toString(36).slice(2, 7)}`, precoCents],
  );
  return rows[0].id;
}

async function ficha(c: Client, produto: string, insumo: string, qtd: number) {
  await c.query(
    `insert into public.product_ingredients
       (restaurant_id, product_id, ingredient_id, quantidade)
     values ($1, $2, $3, $4)`,
    [RESTAURANTE, produto, insumo, qtd],
  );
}

/** Um item de pedido em `pending`, pronto para ser liberado à cozinha. */
async function itemPendente(c: Client, produto: string, qty = 1): Promise<string> {
  const { rows: mesas } = await c.query(
    `select id from public.restaurant_tables
      where restaurant_id = $1 and id not in (
        select table_id from public.table_sessions
         where restaurant_id = $1 and status = 'open')
      limit 1`,
    [RESTAURANTE],
  );
  const { rows: s } = await c.query(
    `insert into public.table_sessions (restaurant_id, table_id, guest_count)
     values ($1, $2, 1) returning id`,
    [RESTAURANTE, mesas[0].id],
  );
  const { rows: g } = await c.query(
    `insert into public.session_guests (restaurant_id, session_id, display_name)
     values ($1, $2, 'Cliente') returning id`,
    [RESTAURANTE, s[0].id],
  );
  const { rows: o } = await c.query(
    `insert into public.orders (restaurant_id, session_id, guest_id, source,
                                idempotency_key, status, approved_by, approved_at)
     values ($1, $2, $3, 'guest', gen_random_uuid()::text, 'approved', $4, now())
     returning id`,
    [RESTAURANTE, s[0].id, g[0].id, DONO],
  );
  const { rows: preco } = await c.query(
    `select price_cents from public.products where id = $1`,
    [produto],
  );
  const total = Number(preco[0].price_cents) * qty;
  const { rows: i } = await c.query(
    `insert into public.order_items
       (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
        total_price_cents, station)
     values ($1, $2, $3, $4, $5, $6, $7, 'cozinha') returning id`,
    [RESTAURANTE, o[0].id, produto, g[0].id, qty, preco[0].price_cents, total],
  );
  return i[0].id;
}

async function saldo(c: Client, insumo: string): Promise<number> {
  const { rows } = await c.query(
    `select quantidade::bigint as q from public.ingredients where id = $1`,
    [insumo],
  );
  return Number(rows[0].q);
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
});
afterAll(async () => {
  await pool.end();
});

describe('a baixa no queued', () => {
  it('desconta a receita vezes a quantidade do item', async () => {
    await comoPostgres(async (c) => {
      const carne = await novoInsumo(c, 1_000_000); // 1 kg em milésimos de grama
      const prod = await novoProduto(c);
      await ficha(c, prod, carne, 150_000); // 150 g por porção

      const item = await itemPendente(c, prod, 3);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);

      // 3 × 150 g = 450 g
      expect(await saldo(c, carne)).toBe(1_000_000 - 450_000);
    });
  });

  it('nada acontece antes do queued', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 500_000);
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 100_000);

      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'held' where id = $1`, [item]);

      expect(await saldo(c, insumo)).toBe(500_000);
    });
  });

  it('a mesma transição repetida não desconta duas vezes', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 500_000);
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 100_000);

      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
      expect(await saldo(c, insumo)).toBe(400_000);

      // Um caminho que reescreve o status sem trocá-lo, e outro que sai e volta.
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
      await c.query(`update public.order_items set status = 'preparing' where id = $1`, [item]);

      expect(await saldo(c, insumo)).toBe(400_000);
    });
  });

  it('o índice único recusa uma segunda baixa do mesmo item', async () => {
    // O teste acima passa pelo retorno antecipado do gatilho ("queued para
    // queued não é evento") e NUNCA chega ao índice. Este chega.
    //
    // Hoje a máquina de estados não tem caminho de volta para `queued`, então
    // o índice é defesa em profundidade: ele existe para o dia em que um
    // segundo caminho de baixa for escrito, e para a corrida entre dois
    // garçons liberando o mesmo item. Sem este teste, seria uma guarda que
    // ninguém nunca viu funcionar.
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 500_000);
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 100_000);
      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
      expect(await saldo(c, insumo)).toBe(400_000);

      await esperaFalhar(
        c,
        `select app.registrar_movimento($1, 'venda', -100000, null, $2)`,
        [insumo, item],
        /uma_baixa|duplicate key/i,
      );
      expect(await saldo(c, insumo)).toBe(400_000);
    });
  });

  it('prato sem ficha técnica não mexe em estoque nenhum', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 500_000);
      const prod = await novoProduto(c); // sem ficha
      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);

      expect(await saldo(c, insumo)).toBe(500_000);
      const { rows } = await c.query(
        `select count(*)::int as n from public.stock_movements where order_item_id = $1`,
        [item],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('falta de estoque não recusa o pedido', () => {
  it('o saldo fica negativo e o item passa mesmo assim', async () => {
    // A regra que mais dói e mais importa: o garçom já aprovou, o cliente está
    // sentado. Recusar aqui seria o sistema discutindo com a realidade.
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 50_000); // 50 g
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 200_000); // a receita pede 200 g

      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);

      const { rows } = await c.query(
        `select status from public.order_items where id = $1`,
        [item],
      );
      expect(rows[0].status).toBe('queued');
      expect(await saldo(c, insumo)).toBe(-150_000);
    });
  });

  it('o negativo aparece na tela em vez de ficar escondido', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, -5_000);
      const { rows } = await c.query(
        `select negativo, abaixo_do_minimo from public.estoque_atual where id = $1`,
        [insumo],
      );
      expect(rows[0].negativo).toBe(true);
    });
  });
});

describe('milésimos são inteiros, e a conta fecha', () => {
  it('trezentas porções de 150 g não acumulam sobra', async () => {
    // O motivo de tudo aqui ser bigint. Em ponto flutuante, somar 0,15 kg
    // trezentas vezes não dá 45 kg — e a diferença apareceria como estoque que
    // ninguém sabe de onde veio.
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 45_000_000); // 45 kg
      for (let i = 0; i < 300; i++) {
        await c.query(`select app.registrar_movimento($1, 'venda', $2)`, [insumo, -150_000]);
      }
      expect(await saldo(c, insumo)).toBe(0);
    });
  });

  it('o extrato e o saldo contam a mesma história', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 0);
      await c.query(`select app.registrar_movimento($1, 'entrada', 10000)`, [insumo]);
      await c.query(`select app.registrar_movimento($1, 'venda', -3500)`, [insumo]);
      await c.query(`select app.registrar_movimento($1, 'perda', -500)`, [insumo]);

      const { rows } = await c.query(
        `select sum(delta)::bigint as soma,
                -- Ordena por seq, e nao por created_at: os tres movimentos
                -- deste teste caem na mesma transacao e compartilham o
                -- timestamp, entao created_at nao desempata.
                (select saldo_depois from public.stock_movements
                  where ingredient_id = $1 order by seq desc limit 1) as ultimo
           from public.stock_movements where ingredient_id = $1`,
        [insumo],
      );
      expect(Number(rows[0].soma)).toBe(6000);
      expect(Number(rows[0].ultimo)).toBe(6000);
      expect(await saldo(c, insumo)).toBe(6000);
    });
  });
});

describe('o prato sai do ar sozinho', () => {
  it('quando o que sobra não faz mais uma porção', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 250_000); // 250 g
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 150_000); // cada porção come 150 g

      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);

      // Sobrou 100 g, e a receita pede 150. Não zerou — mas não dá mais uma.
      expect(await saldo(c, insumo)).toBe(100_000);
      const { rows } = await c.query(
        `select is_available, unavailable_reason from public.products where id = $1`,
        [prod],
      );
      expect(rows[0].is_available).toBe(false);
      expect(rows[0].unavailable_reason).toBe('estoque');
    });
  });

  it('um prato que ainda cabe no que sobrou continua de pé', async () => {
    // O mesmo insumo, duas receitas de tamanhos diferentes. Derrubar as duas
    // seria tirar do cardápio comida que a casa ainda consegue fazer.
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 250_000);
      const grande = await novoProduto(c);
      const pequeno = await novoProduto(c);
      await ficha(c, grande, insumo, 150_000);
      await ficha(c, pequeno, insumo, 20_000);

      const item = await itemPendente(c, grande);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);

      const { rows } = await c.query(
        `select id, is_available from public.products where id = any($1) order by id`,
        [[grande, pequeno]],
      );
      const porId = Object.fromEntries(rows.map((r) => [r.id, r.is_available]));
      expect(porId[grande]).toBe(false); // 100 g não faz 150
      expect(porId[pequeno]).toBe(true); // 100 g faz 20 de sobra
    });
  });

  it('repor estoque NÃO religa o prato sozinho', async () => {
    // Religar automático brigaria com quem desligou por outro motivo — o molho
    // azedou, a chapa quebrou — e o prato voltaria ao cardápio no meio do
    // serviço sem ninguém ter decidido isso.
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 250_000);
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 150_000);

      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
      expect(
        (await c.query(`select is_available from public.products where id = $1`, [prod]))
          .rows[0].is_available,
      ).toBe(false);

      await viraStaff(c, DONO);
      await c.query(`select public.movimentar_estoque($1, 'entrada', 5000000, 'compra')`, [
        insumo,
      ]);
      await c.query('reset role');

      expect(await saldo(c, insumo)).toBe(5_100_000);
      expect(
        (await c.query(`select is_available from public.products where id = $1`, [prod]))
          .rows[0].is_available,
      ).toBe(false);
    });
  });
});

describe('devolução: até onde volta', () => {
  it('recusa em queued devolve o ingrediente', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 1_000_000);
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 100_000);

      const item = await itemPendente(c, prod, 2);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
      expect(await saldo(c, insumo)).toBe(800_000);

      await c.query(
        `update public.order_items
            set status = 'cancelled', rejection_reason = 'cliente_desistiu' where id = $1`,
        [item],
      );
      expect(await saldo(c, insumo)).toBe(1_000_000);
    });
  });

  it('recusa depois de a cozinha começar NÃO devolve', async () => {
    // De `preparing` em diante o ingrediente virou comida. Devolver aqui
    // inflaria o estoque com carne que está na lixeira, e o sistema passaria a
    // informar que existe comida que não existe. Isso é PERDA, e perda se
    // registra à mão — para alguém ter que olhar o número.
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 1_000_000);
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 100_000);

      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
      await c.query(`update public.order_items set status = 'preparing' where id = $1`, [item]);
      await c.query(
        `update public.order_items
            set status = 'cancelled', rejection_reason = 'erro_no_pedido' where id = $1`,
        [item],
      );

      expect(await saldo(c, insumo)).toBe(900_000);
    });
  });

  it('a devolução não acontece duas vezes', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 1_000_000);
      const prod = await novoProduto(c);
      await ficha(c, prod, insumo, 100_000);

      const item = await itemPendente(c, prod);
      await c.query(`update public.order_items set status = 'queued' where id = $1`, [item]);
      await c.query(
        `update public.order_items
            set status = 'out_of_stock', rejection_reason = 'acabou' where id = $1`,
        [item],
      );
      // `out_of_stock` é terminal; forçar o gatilho de novo pelo mesmo caminho
      // não pode somar outra devolução.
      await c.query(
        `update public.order_items set rejection_reason = 'erro_no_pedido' where id = $1`,
        [item],
      );

      expect(await saldo(c, insumo)).toBe(1_000_000);
      const { rows } = await c.query(
        `select count(*)::int as n from public.stock_movements
          where order_item_id = $1 and kind = 'devolucao'`,
        [item],
      );
      expect(rows[0].n).toBe(1);
    });
  });
});

describe('o saldo não se escreve à mão', () => {
  it('nem o dono dá UPDATE em ingredients', async () => {
    // O saldo só muda por movimento registrado — é isso que mantém o extrato
    // honesto. Um UPDATE direto criaria um número que nenhuma linha explica.
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 1000);
      await viraStaff(c, DONO);
      await esperaFalhar(
        c,
        `update public.ingredients set quantidade = 999999 where id = $1`,
        [insumo],
        /permission denied|row-level security/i,
      );
    });
  });

  it('ninguém insere movimento direto', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 1000);
      await viraStaff(c, DONO);
      await esperaFalhar(
        c,
        `insert into public.stock_movements
           (restaurant_id, ingredient_id, kind, delta, saldo_depois)
         values ($1, $2, 'entrada', 5000, 6000)`,
        [RESTAURANTE, insumo],
        /permission denied|row-level security/i,
      );
    });
  });

  it('a equipe não registra "venda" à mão', async () => {
    // Venda é automática. Deixar registrar à mão criaria baixa sem pedido, que
    // é o buraco por onde o estoque some sem rastro.
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 10_000);
      await viraStaff(c, DONO);
      await esperaFalhar(
        c,
        `select public.movimentar_estoque($1, 'venda', -1000)`,
        [insumo],
        /Movimento inválido/,
      );
    });
  });

  it('entrada não tira, perda não põe', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 10_000);
      await viraStaff(c, DONO);
      await esperaFalhar(
        c,
        `select public.movimentar_estoque($1, 'entrada', -500)`,
        [insumo],
        /Entrada não tira/,
      );
      await esperaFalhar(
        c,
        `select public.movimentar_estoque($1, 'perda', 500)`,
        [insumo],
        /Perda não põe/,
      );
      // Ajuste anda nos dois sentidos: a contagem física pode achar mais.
      await c.query(`select public.movimentar_estoque($1, 'ajuste', 300, 'contagem')`, [insumo]);
      await c.query(`select public.movimentar_estoque($1, 'ajuste', -100, 'contagem')`, [insumo]);
      await c.query('reset role');
      expect(await saldo(c, insumo)).toBe(10_200);
    });
  });

  it('garçom não mexe no estoque', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 10_000);
      await viraStaff(c, GARCOM);
      await esperaFalhar(
        c,
        `select public.movimentar_estoque($1, 'perda', -500, 'derrubei')`,
        [insumo],
        /Sem permissão/,
      );
      await esperaFalhar(
        c,
        `select public.criar_insumo('Farinha', 'g')`,
        [],
        /Só dono ou gerente/,
      );
    });
  });

  it('a cozinha registra perda — é ela que vê a comida estragar', async () => {
    await comoPostgres(async (c) => {
      const insumo = await novoInsumo(c, 10_000);
      const { rows: cozinha } = await c.query(
        `select id from public.profiles
          where restaurant_id = $1 and 'kitchen' = any(roles) limit 1`,
        [RESTAURANTE],
      );
      // O seed precisa ter alguém da cozinha; sem isso o teste não testa nada.
      expect(cozinha.length).toBe(1);

      await viraStaff(c, cozinha[0].id);
      await c.query(`select public.movimentar_estoque($1, 'perda', -2000, 'vencido')`, [insumo]);
      await c.query('reset role');
      expect(await saldo(c, insumo)).toBe(8_000);
    });
  });
});

describe('o que a ficha técnica responde', () => {
  it('o custo do prato sai da soma dos insumos', async () => {
    await comoPostgres(async (c) => {
      // Carne a R$ 45,00/kg → 4500 centavos por 1000 g.
      const carne = await novoInsumo(c, 10_000_000, { custo: 4500 });
      // Pão a R$ 1,20 a unidade → 120 centavos por 1000 un… não: por mil
      // unidades seria R$ 1200. Aqui: 1200 centavos por 1000 un = R$ 0,012 cada.
      const pao = await novoInsumo(c, 1_000_000, { unidade: 'un', custo: 120_000 });

      const prod = await novoProduto(c, 3200);
      await ficha(c, prod, carne, 180_000); // 180 g
      await ficha(c, prod, pao, 1_000);     // 1 unidade = 1000 milésimos

      const { rows } = await c.query(
        `select custo_cents, price_cents, itens_na_ficha, porcoes_possiveis
           from public.custo_dos_pratos where product_id = $1`,
        [prod],
      );
      // carne: 180000 × 4500 / 1000000 = 810 centavos
      // pão:     1000 × 120000 / 1000000 = 120 centavos
      expect(Number(rows[0].custo_cents)).toBe(930);
      expect(Number(rows[0].price_cents)).toBe(3200);
      expect(Number(rows[0].itens_na_ficha)).toBe(2);
    });
  });

  it('porções possíveis é o insumo que acaba primeiro', async () => {
    await comoPostgres(async (c) => {
      const muito = await novoInsumo(c, 10_000_000);
      const pouco = await novoInsumo(c, 300_000);
      const prod = await novoProduto(c);
      await ficha(c, prod, muito, 100_000); // dá para 100
      await ficha(c, prod, pouco, 100_000); // dá para 3

      const { rows } = await c.query(
        `select porcoes_possiveis from public.custo_dos_pratos where product_id = $1`,
        [prod],
      );
      expect(Number(rows[0].porcoes_possiveis)).toBe(3);
    });
  });

  it('o valor parado no estoque', async () => {
    await comoPostgres(async (c) => {
      // 10 kg de carne a R$ 45,00/kg = R$ 450,00
      const carne = await novoInsumo(c, 10_000_000, { custo: 4500 });
      const { rows } = await c.query(
        `select valor_cents from public.estoque_atual where id = $1`,
        [carne],
      );
      expect(Number(rows[0].valor_cents)).toBe(45_000);
    });
  });

  it('o insumo não se repete na mesma casa', async () => {
    await comoPostgres(async (c) => {
      await viraStaff(c, DONO);
      await c.query(`select public.criar_insumo('Queijo Prato', 'g')`);
      await esperaFalhar(
        c,
        `select public.criar_insumo('  queijo prato  ', 'g')`,
        [],
        /Já existe um insumo/,
      );
    });
  });

  it('NENHUMA versão de editar_insumo aceita trocar a unidade', async () => {
    // Trocar g por ml reinterpretaria silenciosamente toda receita que aponta
    // para o insumo. A função de edição não oferece o campo.
    //
    // A primeira versão deste teste lia `rows[0].args` — e passou com a guarda
    // quebrada. O motivo: criar uma função com assinatura diferente não
    // SUBSTITUI a original, cria uma SOBRECARGA. As duas passam a existir, o
    // `rows[0]` pegava uma das duas em ordem arbitrária, e metade das vezes
    // pegava a inocente.
    //
    // Agora olha TODAS. Em Postgres, "esta função não faz X" só é verdade se
    // nenhuma sobrecarga dela fizer.
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'editar_insumo'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.args).not.toMatch(/unit/);
      }
    });
  });
});

describe('isolamento entre restaurantes', () => {
  it('a ficha não pode apontar para prato de outra casa', async () => {
    // O furo que a chave composta fecha: gravar uma ficha com o MEU
    // restaurant_id apontando para o produto ALHEIO. A policy só olha o
    // restaurant_id da linha, e a linha é escrita pelo cliente — então sem a
    // chave composta isto passaria, e o estoque desta casa cairia toda vez que
    // a outra vendesse aquele prato.
    await comoPostgres(async (c) => {
      const { rows: r } = await c.query(
        `insert into public.restaurants (name, slug, timezone)
         values ('Outra', 'outra-' || substr(gen_random_uuid()::text, 1, 8),
                 'America/Sao_Paulo') returning id`,
      );
      const { rows: cat } = await c.query(
        `insert into public.categories (restaurant_id, name, sort_order)
         values ($1, 'Cat', 1) returning id`,
        [r[0].id],
      );
      const { rows: alheio } = await c.query(
        `insert into public.products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Prato de fora', 1000) returning id`,
        [r[0].id, cat[0].id],
      );
      const meu = await novoInsumo(c, 1_000_000);

      await esperaFalhar(
        c,
        `insert into public.product_ingredients
           (restaurant_id, product_id, ingredient_id, quantidade)
         values ($1, $2, $3, 1000)`,
        [RESTAURANTE, alheio[0].id, meu],
        /ficha_produto_da_mesma_casa|violates foreign key/i,
      );
    });
  });

  it('existe UM caminho só da ficha para cada tabela', async () => {
    // Duas chaves estrangeiras para a mesma tabela deixam o PostgREST sem
    // saber qual usar no join, e ele recusa com PGRST201.
    //
    // O sintoma não é erro na tela: é a ficha técnica aparecendo VAZIA, com a
    // frase "este prato não desconta nada do estoque" — plausível o bastante
    // para ninguém desconfiar. Foi assim que apareceu, e foi assim que quase
    // passou.
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select confrelid::regclass::text as destino, count(*)::int as quantas
           from pg_constraint
          where conrelid = 'public.product_ingredients'::regclass and contype = 'f'
          group by confrelid order by 1`,
      );
      for (const r of rows) {
        expect({ destino: r.destino, quantas: r.quantas }).toEqual({
          destino: r.destino,
          quantas: 1,
        });
      }
    });
  });

  it('a ficha não pode apontar para insumo de outra casa', async () => {
    await comoPostgres(async (c) => {
      const { rows: r } = await c.query(
        `insert into public.restaurants (name, slug, timezone)
         values ('Outra', 'outra-' || substr(gen_random_uuid()::text, 1, 8),
                 'America/Sao_Paulo') returning id`,
      );
      const { rows: alheio } = await c.query(
        `insert into public.ingredients (restaurant_id, name, unit, quantidade)
         values ($1, 'Insumo de fora', 'g', 1000) returning id`,
        [r[0].id],
      );
      const meuPrato = await novoProduto(c);

      await esperaFalhar(
        c,
        `insert into public.product_ingredients
           (restaurant_id, product_id, ingredient_id, quantidade)
         values ($1, $2, $3, 1000)`,
        [RESTAURANTE, meuPrato, alheio[0].id],
        /ficha_insumo_da_mesma_casa|violates foreign key/i,
      );
    });
  });

  it('o insumo de outra casa não aparece', async () => {
    await comoPostgres(async (c) => {
      const { rows: r } = await c.query(
        `insert into public.restaurants (name, slug, timezone)
         values ('Outra', 'outra-' || substr(gen_random_uuid()::text, 1, 8),
                 'America/Sao_Paulo') returning id`,
      );
      const { rows: i } = await c.query(
        `insert into public.ingredients (restaurant_id, name, unit, quantidade)
         values ($1, 'Alheio', 'g', 999) returning id`,
        [r[0].id],
      );

      await viraStaff(c, DONO);
      const { rows } = await c.query(
        `select 1 from public.estoque_atual where id = $1`,
        [i[0].id],
      );
      expect(rows).toHaveLength(0);
    });
  });
});
