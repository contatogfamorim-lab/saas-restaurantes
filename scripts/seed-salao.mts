/**
 * Cenário de salão para inspeção visual — APENAS local.
 *
 *   pnpm db:salao
 *
 * Monta uma mesa para cada alerta da spec §5, porque um mapa com uma mesa
 * vermelha e sete vazias não permite julgar se o semáforo funciona. Aqui dá
 * para ver as seis cores lado a lado e decidir se a hierarquia se sustenta a
 * um metro de distância.
 *
 * Escreve como `postgres`, ignorando RLS: é ferramenta de desenvolvimento
 * fabricando estado que levaria uma noite de serviço para acontecer.
 */
import { Client } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE = '11111111-1111-4111-8111-111111111111';
const GARCOM = 'aaaaaaaa-0000-4000-8000-000000000002';

const AGUA = '44444444-0000-4000-8000-000000000023';
const SMASH = '44444444-0000-4000-8000-000000000001';
const CHEDDAR = '44444444-0000-4000-8000-000000000003';
const FRITAS = '44444444-0000-4000-8000-000000000013';
const PETIT = '44444444-0000-4000-8000-000000000020';

const c = new Client({ connectionString: DATABASE_URL });

async function mesa(label: string): Promise<{ id: string; short_code: string }> {
  const { rows } = await c.query(
    `select id, short_code from restaurant_tables
      where restaurant_id = $1 and label = $2`,
    [RESTAURANTE, label],
  );
  return rows[0];
}

async function abrir(label: string, nome: string, minutosAtras = 0) {
  const t = await mesa(label);
  const { rows } = await c.query(
    `insert into table_sessions (restaurant_id, table_id, waiter_id, opened_at)
     values ($1, $2, $3, now() - make_interval(mins => $4::int)) returning id`,
    [RESTAURANTE, t.id, GARCOM, minutosAtras],
  );
  const sessionId = rows[0].id as string;

  const { rows: g } = await c.query(
    `insert into session_guests (restaurant_id, session_id, display_name, device_hash)
     values ($1, $2, $3, $4) returning id`,
    [RESTAURANTE, sessionId, nome, `dev-${label}`],
  );

  return { sessionId, guestId: g[0].id as string, tableId: t.id as string };
}

/** Lança itens direto, sem passar pela validação — é fixture, não fluxo. */
async function itens(
  sessionId: string,
  guestId: string,
  lista: { produto: string; qty: number; status: string; minutosAtras?: number }[],
) {
  const { rows: o } = await c.query(
    `insert into orders (restaurant_id, session_id, guest_id, source, idempotency_key, status, approved_by, approved_at)
     values ($1, $2, $3, 'guest', $4, 'approved', $5, now()) returning id`,
    [RESTAURANTE, sessionId, guestId, `salao-${crypto.randomUUID()}`, GARCOM],
  );
  const orderId = o[0].id as string;

  for (const item of lista) {
    const { rows: p } = await c.query(
      `select p.price_cents, coalesce(p.station_override, cat.station) as station
         from products p join categories cat on cat.id = p.category_id
        where p.id = $1`,
      [item.produto],
    );

    const { rows: oi } = await c.query(
      `insert into order_items (restaurant_id, order_id, product_id, guest_id, qty,
                                unit_price_cents, total_price_cents, station)
       values ($1, $2, $3, $4, $5, $6::int, $6::int * $5::int, $7) returning id`,
      [RESTAURANTE, orderId, item.produto, guestId, item.qty, p[0].price_cents, p[0].station],
    );

    // A máquina de estados exige passo a passo; o trigger carimba os
    // timestamps. Depois recuamos queued_at para simular o tempo decorrido.
    const caminho = ['queued', 'preparing', 'ready', 'delivered'];
    for (const s of caminho) {
      await c.query(`update order_items set status = $1 where id = $2`, [s, oi[0].id]);
      if (s === item.status) break;
    }

    if (item.minutosAtras) {
      await c.query(
        `update order_items
            set queued_at = now() - make_interval(mins => $2::int),
                started_at = case when started_at is not null
                                  then now() - make_interval(mins => $2::int - 1) end,
                ready_at = case when ready_at is not null
                                then now() - make_interval(mins => $2::int - 2) end
          where id = $1`,
        [oi[0].id, item.minutosAtras],
      );
    }
  }

  return orderId;
}

async function main() {
  await c.connect();

  // Transação explícita, e não autocommit.
  //
  // A checagem de `total_price_cents` é uma CONSTRAINT TRIGGER DEFERIDA: ela
  // roda no COMMIT. Com autocommit, cada INSERT commita sozinho e a checagem
  // dispara antes de os modificadores existirem — o item pareceria
  // inconsistente por um instante que, em autocommit, é o instante que conta.
  await c.query('begin');

  // limpa o cenário anterior para o script ser reexecutável
  await c.query(
    `update table_sessions set status = 'closed', closed_at = now()
      where restaurant_id = $1 and status in ('open', 'closing')`,
    [RESTAURANTE],
  );

  // --- Mesa 1: pedido aguardando aprovação (vermelho) -----------------------
  {
    const m = await abrir('Mesa 1', 'Tereza', 12);
    await c.query(
      `insert into orders (restaurant_id, session_id, guest_id, source, idempotency_key)
       values ($1, $2, $3, 'guest', $4)`,
      [RESTAURANTE, m.sessionId, m.guestId, `salao-${crypto.randomUUID()}`],
    );
    const { rows: o } = await c.query(
      `select id from orders where session_id = $1 order by created_at desc limit 1`,
      [m.sessionId],
    );
    for (const [produto, qty] of [[SMASH, 1], [AGUA, 2]] as const) {
      const { rows: p } = await c.query(
        `select p.price_cents, coalesce(p.station_override, cat.station) as station
           from products p join categories cat on cat.id = p.category_id where p.id = $1`,
        [produto],
      );
      // O total precisa JÁ nascer somando os modificadores: `total_price_cents`
      // de item lançado é imutável (trigger order_item_price_is_frozen), e a
      // constraint deferida confere (unit + Σ modificadores) × qty no commit.
      // Corrigir depois seria bloqueado pelas duas — corretamente.
      const extra = produto === SMASH ? 700 : 0;

      const { rows: oi } = await c.query(
        `insert into order_items (restaurant_id, order_id, product_id, guest_id, qty,
                                  unit_price_cents, total_price_cents, station, notes)
         values ($1, $2, $3, $4, $5, $6::int, ($6::int + $9::int) * $5::int, $7, $8)
         returning id`,
        [RESTAURANTE, o[0].id, produto, m.guestId, qty, p[0].price_cents, p[0].station,
         produto === SMASH ? 'sem cebola, bem passado' : null, extra],
      );

      if (produto === SMASH) {
        await c.query(
          `insert into order_item_modifiers (restaurant_id, order_item_id, group_name, option_name, price_delta_cents)
           values ($1, $2, 'Ponto da carne', 'Bem passado', 0),
                  ($1, $2, 'Acompanhamento', 'Onion rings', 700)`,
          [RESTAURANTE, oi[0].id],
        );
      }
    }
  }

  // --- Mesa 2: item pronto esperando entrega há 6 min (laranja) -------------
  {
    const m = await abrir('Mesa 2', 'Bruno', 40);
    await itens(m.sessionId, m.guestId, [
      { produto: CHEDDAR, qty: 2, status: 'ready', minutosAtras: 8 },
      { produto: AGUA, qty: 2, status: 'delivered', minutosAtras: 35 },
    ]);
  }

  // --- Mesa 3: chamou o garçom (vermelho) -----------------------------------
  {
    const m = await abrir('Mesa 3', 'Célia', 25);
    await itens(m.sessionId, m.guestId, [
      { produto: SMASH, qty: 2, status: 'delivered', minutosAtras: 20 },
    ]);
    await c.query(
      `insert into waiter_calls (restaurant_id, session_id, table_id, type, created_at)
       values ($1, $2, $3, 'request_bill', now() - interval '4 minutes')`,
      [RESTAURANTE, m.sessionId, m.tableId],
    );
  }

  // --- Mesa 4: item atrasado (laranja) --------------------------------------
  // Smash tem prep_minutes 14; 30 min na fila passa de 1,5×
  {
    const m = await abrir('Mesa 4', 'Dário', 35);
    await itens(m.sessionId, m.guestId, [
      { produto: SMASH, qty: 3, status: 'preparing', minutosAtras: 30 },
    ]);
  }

  // --- Mesa 5: indecisa — aberta há 14 min, nenhum pedido (amarelo) ---------
  await abrir('Mesa 5', 'Eva', 14);

  // --- Mesa 6: sem bebida — 2 itens de comida, nada do bar (amarelo) --------
  {
    const m = await abrir('Mesa 6', 'Fábio', 18);
    await itens(m.sessionId, m.guestId, [
      { produto: FRITAS, qty: 1, status: 'delivered', minutosAtras: 12 },
      { produto: SMASH, qty: 2, status: 'delivered', minutosAtras: 12 },
    ]);
  }

  // --- Mesa 7: tranquila — tudo entregue, com bebida (branco) ---------------
  {
    const m = await abrir('Mesa 7', 'Gil', 50);
    await itens(m.sessionId, m.guestId, [
      { produto: CHEDDAR, qty: 2, status: 'delivered', minutosAtras: 40 },
      { produto: AGUA, qty: 2, status: 'delivered', minutosAtras: 40 },
      { produto: PETIT, qty: 1, status: 'delivered', minutosAtras: 10 },
    ]);
  }

  // --- Mesa 8: livre --------------------------------------------------------

  const { rows } = await c.query(
    `select t.label,
            case when s.id is null then 'livre' else 'ocupada' end as estado,
            coalesce(st.total_cents, 0) as total
       from restaurant_tables t
       left join table_sessions s on s.table_id = t.id and s.status = 'open'
       left join session_totals st on st.session_id = s.id
      where t.restaurant_id = $1
      order by t.label`,
    [RESTAURANTE],
  );

  console.log('\nCenário montado:\n');
  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(8)} ${r.estado.padEnd(9)} ${
        r.total ? `R$ ${(r.total / 100).toFixed(2)}` : ''
      }`,
    );
  }
  console.log('\n  ADMINISTRADOR  /app/entrar?admin=1  ·  dono@brasaburger.test  ·  senha-de-teste-123');
  console.log('  OPERADORES     /app/operador (depois de liberar o aparelho)');
  console.log('                   01 / 47628  Ivo    garçom');
  console.log('                   02 / 91387  Ravi   cozinha');
  console.log('                   03 / 29574  Selma  caixa');
  console.log('                   04 / 64839  Nara   garçom + caixa\n');

  await c.query('commit');
  await c.end();
}

main().catch(async (err) => {
  console.error('✗ seed-salao falhou:', err instanceof Error ? err.message : err);
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  process.exit(1);
});
