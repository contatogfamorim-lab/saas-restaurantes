/**
 * Histórico de vendas para o console de gestão — APENAS local.
 *
 *   pnpm db:historico
 *
 * Um dashboard com um dia de dados não permite julgar nada: não dá para ver se
 * a série temporal respira, se o ticket médio faz sentido, se o gráfico aguenta
 * um domingo fraco ao lado de um sábado cheio. Aqui saem 21 noites de
 * movimento, com a forma que restaurante tem de verdade — sexta e sábado
 * pesados, segunda parada.
 *
 * Escreve como `postgres`, ignorando RLS: é ferramenta de desenvolvimento
 * fabricando estado que levaria três semanas de serviço para acontecer.
 *
 * O QUE ESTE SCRIPT NÃO INVENTA
 *
 * Preço. Cada item copia `products.price_cents` no instante em que é criado, do
 * mesmo jeito que `create_guest_order` faria — porque o relatório lê o preço
 * congelado, e semear com um preço diferente do catálogo produziria números
 * bonitos que escondem justamente o bug que a §16 manda procurar.
 */
import { Client } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE = '11111111-1111-4111-8111-111111111111';
const DIAS = 21;

const c = new Client({ connectionString: DATABASE_URL });
await c.connect();

/**
 * Peso de movimento por dia da semana (0 = domingo).
 * Sexta e sábado carregam a semana; segunda quase não existe.
 */
const MOVIMENTO = [8, 3, 5, 6, 9, 14, 16];

const equipe = await pegar(
  `select id, roles from public.profiles where restaurant_id = $1 and active`,
);
const garcons = equipe.filter((p) => p.roles.includes('waiter')).map((p) => p.id);
const caixas = equipe.filter((p) => p.roles.includes('cashier')).map((p) => p.id);

const mesas = (await pegar(`select id from public.restaurant_tables where restaurant_id = $1`))
  .map((t) => t.id as string);

const produtos = await pegar(
  `select p.id, p.price_cents, p.prep_minutes,
          coalesce(p.station_override, cat.station) as station
     from public.products p
     join public.categories cat on cat.id = p.category_id
    where p.restaurant_id = $1 and p.is_available`,
);

const promocoes = await pegar(
  `select id, discount_type, discount_value from public.promotions
    where restaurant_id = $1 and status = 'active'`,
);

async function pegar(sql: string) {
  const { rows } = await c.query(sql, [RESTAURANTE]);
  return rows;
}

const sorteio = <T,>(lista: T[]): T => lista[Math.floor(Math.random() * lista.length)];
const entre = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/**
 * Leva os itens de um pedido pela máquina de estados, um passo por vez.
 *
 * Cada UPDATE é uma transição que o trigger valida, exatamente como aconteceria
 * numa noite: pendente → fila → preparo → pronto → entregue. Os carimbos são
 * escritos junto porque o trigger só preenche com `now()` quando vêm nulos, e
 * `now()` daria a todos os 21 dias o horário de agora.
 *
 * Antes de tudo, ~4% dos itens saem pela porta de trás: recusados pelo garçom
 * ou esgotados na cozinha. Só de 'pending' — é de lá que a recusa parte.
 */
async function avancarPedido(orderId: string) {
  await c.query(
    `update public.order_items
        -- Estado e motivo saem do MESMO sorteio. Sorteados em separado, sai
        -- "esgotou porque o cliente desistiu", que não quer dizer nada — e um
        -- relatório de recusas cheio de combinação impossível não deixa julgar
        -- se a tela está certa.
        --
        -- O sorteio é um hash do próprio id, e não random(): random() numa
        -- lista de SET é avaliado duas vezes, uma por coluna, e os dois valores
        -- não têm por que coincidir. Um subselect resolveria isso avaliando uma
        -- vez só — por COMANDO, dando o mesmo motivo a todos os itens.
        set status = (case when md5(id::text) < '8' then 'cancelled' else 'out_of_stock' end)
                     ::public.order_item_status,
            rejection_reason = (case when md5(id::text) < '8' then 'cliente_desistiu' else 'acabou' end)
                     ::public.rejection_reason
      where order_id = $1 and status = 'pending' and random() < 0.04`,
    [orderId],
  );

  await c.query(
    `update public.order_items
        set status = 'queued', queued_at = created_at + make_interval(mins => 1 + floor(random() * 5)::int)
      where order_id = $1 and status = 'pending'`,
    [orderId],
  );

  await c.query(
    `update public.order_items
        set status = 'preparing', started_at = queued_at + make_interval(mins => floor(random() * 6)::int)
      where order_id = $1 and status = 'queued'`,
    [orderId],
  );

  // O tempo de produção sai do `prep_minutes` do produto, PROPORCIONAL e não
  // somado. A primeira versão fazia `prep + random(-3..9)`, o que trata um
  // chopp de 2 minutos e uma costela de 25 com a mesma folga absoluta: a
  // bebida estourava 1,5× do previsto quase sempre, e a tela de operação
  // acusava 65% de atraso no bar por artefato da semente.
  //
  // De 0,7× a 1,6× do previsto deixa perto de um quinto passando do limite,
  // que é uma noite ruim plausível em vez de um incêndio.
  await c.query(
    `update public.order_items oi
        set status = 'ready',
            ready_at = oi.started_at
                     + make_interval(secs => greatest(60,
                         (p.prep_minutes * 60 * (0.7 + random() * 0.9))::int))
       from public.products p
      where p.id = oi.product_id and oi.order_id = $1 and oi.status = 'preparing'`,
    [orderId],
  );

  await c.query(
    `update public.order_items
        set status = 'delivered', delivered_at = ready_at + make_interval(mins => 1 + floor(random() * 4)::int)
      where order_id = $1 and status = 'ready'`,
    [orderId],
  );
}

const NOMES = [
  'Tereza', 'Ivo', 'Cleuza', 'Wanderley', 'Sirlene', 'Josimar', 'Neide',
  'Adalberto', 'Marlene', 'Genivaldo', 'Zuleica', 'Osvaldo', 'Iracema',
];

const METODOS = ['pix', 'credito', 'debito', 'dinheiro'] as const;
/** Como se paga em hamburgueria: pix e crédito levam quase tudo. */
const PESO_METODO = [40, 33, 17, 10];

function metodoSorteado(): string {
  const total = PESO_METODO.reduce((s, p) => s + p, 0);
  let n = Math.random() * total;
  for (const [i, peso] of PESO_METODO.entries()) {
    n -= peso;
    if (n <= 0) return METODOS[i];
  }
  return 'pix';
}

let comandas = 0;
let itens = 0;

await c.query('begin');

for (let d = DIAS; d >= 1; d--) {
  // A data de referência é o fuso do restaurante, não UTC: é assim que a view
  // `daily_sales` corta o dia, e semear em UTC deslocaria a noite inteira.
  // `to_char` e não `::date`: o driver devolve `date` como objeto Date do JS, e
  // interpolar isso numa string dá "Wed Aug 06 2026 00:00:00 GMT-0300", que o
  // Postgres recusa na volta.
  const { rows: [ref] } = await c.query(
    `select to_char((now() at time zone 'America/Sao_Paulo')::date - $1::int, 'YYYY-MM-DD') as dia,
            extract(dow from (now() at time zone 'America/Sao_Paulo')::date - $1::int)::int as dow`,
    [d],
  );

  const quantas = Math.max(1, MOVIMENTO[ref.dow] + entre(-2, 3));

  for (let i = 0; i < quantas; i++) {
    // Serviço das 18h às 23h30; a mesa fica de 40 a 110 minutos.
    const abertura = `${ref.dia} ${18 + Math.floor(Math.random() * 5)}:${entre(0, 59)
      .toString()
      .padStart(2, '0')}:00 America/Sao_Paulo`;
    const duracao = entre(40, 110);
    const pessoas = entre(1, 5);
    const garcom = sorteio(garcons);

    const { rows: [sessao] } = await c.query(
      `insert into public.table_sessions
         (restaurant_id, table_id, waiter_id, guest_count, status, opened_at, closed_at)
       values ($1, $2, $3, $4, 'closed', $5::timestamptz,
               $5::timestamptz + make_interval(mins => $6::int))
       returning id, opened_at`,
      [RESTAURANTE, sorteio(mesas), garcom, pessoas, abertura, duracao],
    );

    const { rows: [convidado] } = await c.query(
      `insert into public.session_guests
         (restaurant_id, session_id, display_name, phone, lgpd_consent_at, joined_at)
       values ($1, $2, $3, $4, case when $4::text is null then null else $5::timestamptz end,
               $5::timestamptz)
       returning id`,
      [
        RESTAURANTE,
        sessao.id,
        sorteio(NOMES),
        // Nem todo mundo deixa telefone — e sem consentimento não entra (§10.9).
        Math.random() < 0.45 ? `11${entre(90000, 99999)}${entre(1000, 9999)}` : null,
        sessao.opened_at,
      ],
    );

    const { rows: [pedido] } = await c.query(
      `insert into public.orders
         (restaurant_id, session_id, guest_id, source, idempotency_key, created_at)
       values ($1, $2, $3, 'guest', $4, $5::timestamptz) returning id`,
      [RESTAURANTE, sessao.id, convidado.id, `hist-${crypto.randomUUID()}`, sessao.opened_at],
    );

    // Uma pessoa pede de 1 a 3 coisas.
    for (let n = 0; n < pessoas * entre(1, 3); n++) {
      const prod = sorteio(produtos);
      const qty = Math.random() < 0.85 ? 1 : 2;

      // Uma em cada oito linhas leva promoção — o suficiente para a tela de
      // promoções ter o que mostrar sem virar liquidação.
      const promo = promocoes.length > 0 && Math.random() < 0.12 ? sorteio(promocoes) : null;

      const cheio = prod.price_cents as number;
      const unitario =
        promo?.discount_type === 'percent'
          ? Math.round(cheio * (1 - Number(promo.discount_value) / 100))
          : promo?.discount_type === 'fixed_price'
            ? Number(promo.discount_value)
            : cheio;

      // O item NASCE pendente — a trigger `order_item_starts_pending` recusa
      // qualquer outra coisa, e é ela que garante que nada pule a aprovação do
      // garçom. Semear o estado final direto contornaria a máquina de estados,
      // e aí este script estaria produzindo dados que o app não consegue criar.
      await c.query(
        `insert into public.order_items
           (restaurant_id, order_id, product_id, guest_id, qty, unit_price_cents,
            total_price_cents, original_price_cents, promotion_id, station, created_at)
         values ($1, $2, $3, $4, $5::int, $6::int, $6::int * $5::int, $7::int, $8, $9,
                 $10::timestamptz)`,
        [
          RESTAURANTE, pedido.id, prod.id, convidado.id, qty, unitario,
          promo ? cheio : null, promo?.id ?? null, prod.station, sessao.opened_at,
        ],
      );
      itens++;
    }

    await avancarPedido(pedido.id);

    // Desconto acontece de vez em quando, e sempre com motivo (§10.7).
    if (Math.random() < 0.08) {
      await c.query(
        `insert into public.session_adjustments
           (restaurant_id, session_id, type, amount_cents, reason, created_by, created_at)
         select $1, $2, 'discount',
                greatest(round(t.total_cents * 0.1)::int, 100),
                'cortesia da casa', $3, $4::timestamptz
           from public.session_totals t where t.session_id = $2 and t.total_cents > 0`,
        [RESTAURANTE, sessao.id, sorteio(caixas), sessao.opened_at],
      );
    }

    // Paga o saldo exato — comanda fechada com saldo pendente seria outro
    // cenário, e este script está semeando noites que terminaram bem.
    await c.query(
      `insert into public.payments
         (restaurant_id, session_id, method, amount_cents, created_by,
          idempotency_key, created_at)
       select $1, $2, $3::public.payment_method, t.total_cents, $4, $5,
              $6::timestamptz + make_interval(mins => $7::int)
         from public.session_totals t
        where t.session_id = $2 and t.total_cents > 0`,
      [
        RESTAURANTE, sessao.id, metodoSorteado(), sorteio(caixas),
        `hist-pg-${crypto.randomUUID()}`, sessao.opened_at, duracao,
      ],
    );

    comandas++;
  }
}

await c.query('commit');

// O resumo NÃO sai de `daily_sales`: este script roda como `postgres`, que não
// tem papel, e a view exige owner/manager. Ela devolveria zero — corretamente.
const { rows: [resumo] } = await c.query(
  `select count(distinct (s.opened_at at time zone r.timezone)::date)::int as dias,
          count(*)::int as comandas,
          coalesce(sum(t.total_cents), 0)::bigint as total
     from public.table_sessions s
     join public.restaurants r on r.id = s.restaurant_id
     join public.session_totals t on t.session_id = s.id
    where s.restaurant_id = $1 and s.status <> 'cancelled'`,
  [RESTAURANTE],
);

console.log(`✓ ${comandas} comandas, ${itens} itens, ${DIAS} noites`);
console.log(
  `  daily_sales: ${resumo.dias} dias, ${resumo.comandas} comandas, ` +
    `R$ ${(Number(resumo.total) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
);

await c.end();
