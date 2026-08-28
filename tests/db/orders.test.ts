/**
 * Testes da criação de pedido — a regra de ouro da spec §10.1.
 *
 *   pnpm test:db
 *
 * O que estes testes precisam provar, em uma frase: **não existe caminho pelo
 * qual o cliente influencie o preço**. Tudo o mais aqui é consequência disso.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

import { prepararBanco } from './_prepare';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE_A = '11111111-1111-4111-8111-111111111111';
const SMASH_CLASSICO = '44444444-0000-4000-8000-000000000001'; // exige ponto + acompanhamento
const AGUA = '44444444-0000-4000-8000-000000000023'; // sem grupo obrigatório
const COSTELA = '44444444-0000-4000-8000-000000000005'; // promoção com estoque
const CHOPP = '44444444-0000-4000-8000-000000000028'; // categoria Happy Hour (fora de hora)

let pool: Pool;
let shortCode: string;

/** Executa num cliente próprio, dentro de transação desfeita ao final. */
async function emTransacao<T>(fn: (c: Client) => Promise<T>): Promise<T> {
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

/** Abre comanda e identifica um cliente, como faz o Route Handler. */
async function abrirComanda(c: Client, nome = 'Tereza', device = 'dev-1') {
  const { rows } = await c.query(
    `select public.open_guest_session($1, $2, '', $3, false) as r`,
    [shortCode, nome, device],
  );
  return rows[0].r as { session_id: string; guest_id: string };
}

/**
 * Uma opção válida para cada grupo OBRIGATÓRIO do produto.
 *
 * Escrito genérico de propósito: fixar ids à mão faria o teste quebrar toda vez
 * que o seed mudasse, e o que ele mede não tem nada a ver com qual ponto de
 * carne foi escolhido.
 */
async function opcoesObrigatorias(c: Client, productId: string): Promise<string[]> {
  const { rows } = await c.query(
    `select distinct on (mg.id) mo.id
       from modifier_groups mg
       join product_modifier_groups pmg on pmg.group_id = mg.id
       join modifier_options mo on mo.group_id = mg.id
      where pmg.product_id = $1 and mg.is_required and mo.is_available
      order by mg.id, mo.sort_order`,
    [productId],
  );
  return rows.map((r) => r.id as string);
}

async function opcaoDoGrupo(c: Client, grupo: string): Promise<string> {
  const { rows } = await c.query(
    `select mo.id from modifier_options mo
       join modifier_groups mg on mg.id = mo.group_id
      where mg.name = $1 and mg.restaurant_id = $2
      order by mo.sort_order limit 1`,
    [grupo, RESTAURANTE_A],
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepararBanco(pool, RESTAURANTE_A);
  const { rows } = await pool.query(
    `select short_code from restaurant_tables where restaurant_id = $1 order by label limit 1`,
    [RESTAURANTE_A],
  );
  shortCode = rows[0].short_code;
});

afterAll(async () => {
  await pool?.end();
});

// ===========================================================================
describe('§10.1 — o servidor nunca confia no cliente', () => {
  it('o preço gravado vem do banco, não do pedido', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);

      const { rows: [pedido] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
        [session_id, guest_id, 'idem-preco', JSON.stringify([
          // Campos monetários DELIBERADAMENTE presentes no payload.
          // A função não os lê — e é isso que este teste prova.
          {
            product_id: AGUA,
            qty: 2,
            unit_price_cents: 1,
            total_price_cents: 1,
            price: 0,
            discount: 99,
          },
        ])],
      );

      const { rows: [item] } = await c.query(
        `select oi.unit_price_cents, oi.total_price_cents, p.price_cents
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = $1`,
        [pedido.id],
      );

      expect(item.unit_price_cents).toBe(item.price_cents);
      expect(item.unit_price_cents).toBe(700);
      expect(item.total_price_cents).toBe(1400);
    });
  });

  it('§16 — o preço do cardápio é exatamente o preço lançado', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);

      // o que o cardápio mostraria
      const { rows: [vitrine] } = await c.query(
        `select effective_price_cents from product_effective_prices where product_id = $1`,
        [COSTELA],
      );

      const obrigatorias = await opcoesObrigatorias(c, COSTELA);
      const { rows: [pedido] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
        [session_id, guest_id, 'idem-vitrine',
         JSON.stringify([{ product_id: COSTELA, qty: 1,
                           modifier_option_ids: obrigatorias }])],
      );

      const { rows: [item] } = await c.query(
        `select unit_price_cents, original_price_cents from order_items where order_id = $1`,
        [pedido.id],
      );

      expect(item.unit_price_cents).toBe(vitrine.effective_price_cents);
      expect(item.unit_price_cents).toBe(3900);
      // preço cheio guardado ao lado, para o dashboard medir o desconto
      expect(item.original_price_cents).toBe(5200);
    });
  });

  it.each([0, -1, 21, 1.5])('qty = %s é rejeitado', async (qty) => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, `idem-qty-${qty}`,
          JSON.stringify([{ product_id: AGUA, qty }]),
        ]),
      ).rejects.toThrow();
    });
  });

  it('qty como string é rejeitado, não convertido', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, 'idem-qty-str',
          JSON.stringify([{ product_id: AGUA, qty: '5' }]),
        ]),
      ).rejects.toThrow(/Quantidade inválida/i);
    });
  });

  it('produto de outro restaurante é rejeitado', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      const { rows: [outro] } = await c.query(
        `insert into restaurants (name, slug) values ('Outro', 'outro-' || gen_random_uuid()) returning id`);
      const { rows: [cat] } = await c.query(
        `insert into categories (restaurant_id, name) values ($1, 'X') returning id`, [outro.id]);
      const { rows: [prod] } = await c.query(
        `insert into products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Espião', 100) returning id`, [outro.id, cat.id]);

      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, 'idem-cross',
          JSON.stringify([{ product_id: prod.id, qty: 1 }]),
        ]),
      ).rejects.toThrow(/não está disponível/i);
    });
  });

  it('produto esgotado é rejeitado', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      await c.query(`update products set is_available = false where id = $1`, [AGUA]);
      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, 'idem-esgotado',
          JSON.stringify([{ product_id: AGUA, qty: 1 }]),
        ]),
      ).rejects.toThrow(/não está disponível/i);
    });
  });

  it('§4 — produto de categoria fora do horário é rejeitado', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      // Fecha a janela para agora — e a janela é calculada A PARTIR DE AGORA.
      //
      // A versão anterior fixava '03:00'–'03:30', supondo que ninguém rodaria
      // os testes de madrugada. Rodei às 03:04 e o teste caiu: a janela que
      // deveria estar FECHADA estava aberta, o produto passou pela checagem de
      // horário, e o erro que apareceu foi o do modificador obrigatório.
      //
      // Um teste que só passa 23 horas e meia por dia não é um teste — é uma
      // armadilha para quem trabalhar no horário errado.
      await c.query(
        `update categories
            set available_from = ((now() at time zone 'America/Sao_Paulo') + interval '2 hours')::time,
                available_to   = ((now() at time zone 'America/Sao_Paulo') + interval '3 hours')::time,
                days_of_week = array[0,1,2,3,4,5,6]
          where name = 'Happy Hour' and restaurant_id = $1`, [RESTAURANTE_A]);

      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, 'idem-horario',
          JSON.stringify([{ product_id: CHOPP, qty: 1 }]),
        ]),
      ).rejects.toThrow(/não está disponível/i);
    });
  });
});

// ===========================================================================
describe('§10.1 — modificadores', () => {
  it('grupo obrigatório não satisfeito é rejeitado', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, 'idem-obrig',
          JSON.stringify([{ product_id: SMASH_CLASSICO, qty: 1 }]),
        ]),
      ).rejects.toThrow(/Escolha/i);
    });
  });

  it('opção que não pertence ao produto é rejeitada', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      // "Tamanho" só se aplica ao chopp — não ao Smash Clássico
      const tamanho = await opcaoDoGrupo(c, 'Tamanho');
      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, 'idem-modinv',
          JSON.stringify([{ product_id: SMASH_CLASSICO, qty: 1,
                            modifier_option_ids: [tamanho] }]),
        ]),
      ).rejects.toThrow(/Opção inválida/i);
    });
  });

  it('o valor do modificador vem do banco e entra no total', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      const ponto = await opcaoDoGrupo(c, 'Ponto da carne'); // +0
      // "Onion rings" custa +700 no grupo Acompanhamento
      const { rows: [onion] } = await c.query(
        `select mo.id from modifier_options mo join modifier_groups mg on mg.id = mo.group_id
          where mg.name = 'Acompanhamento' and mo.name = 'Onion rings'`);

      const { rows: [pedido] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`, [
          session_id, guest_id, 'idem-mods',
          JSON.stringify([{ product_id: SMASH_CLASSICO, qty: 2,
                            modifier_option_ids: [ponto, onion.id] }]),
        ]);

      const { rows: [item] } = await c.query(
        `select unit_price_cents, total_price_cents from order_items where order_id = $1`,
        [pedido.id]);

      // (3200 base + 700 onion) × 2
      expect(item.unit_price_cents).toBe(3200);
      expect(item.total_price_cents).toBe(7800);

      // SNAPSHOT: nome e valor congelados no momento do pedido
      const { rows: mods } = await c.query(
        `select group_name, option_name, price_delta_cents from order_item_modifiers
          where order_item_id = (select id from order_items where order_id = $1)
          order by price_delta_cents`, [pedido.id]);
      expect(mods).toHaveLength(2);
      expect(mods[1].option_name).toBe('Onion rings');
      expect(mods[1].price_delta_cents).toBe(700);
    });
  });
});

// ===========================================================================
describe('§13.7 — idempotência', () => {
  it('a mesma chave devolve o mesmo pedido, sem duplicar', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      const item = JSON.stringify([{ product_id: AGUA, qty: 1 }]);

      const { rows: [a] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
        [session_id, guest_id, 'idem-repetida', item]);
      const { rows: [b] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
        [session_id, guest_id, 'idem-repetida', item]);

      expect(b.id).toBe(a.id);

      const { rows: [contagem] } = await c.query(
        `select count(*)::int as n from orders where session_id = $1`, [session_id]);
      expect(contagem.n).toBe(1);
    });
  });

  it('chaves diferentes criam pedidos diferentes, mesmo com carrinho idêntico', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      const item = JSON.stringify([{ product_id: AGUA, qty: 1 }]);

      const { rows: [a] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
        [session_id, guest_id, 'rodada-1', item]);
      const { rows: [b] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
        [session_id, guest_id, 'rodada-2', item]);

      // "quero mais um igual" precisa virar pedido novo
      expect(b.id).not.toBe(a.id);
    });
  });
});

// ===========================================================================
describe('§10.6 — freio de rajada', () => {
  it('o sétimo pedido no mesmo minuto é bloqueado', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      const item = JSON.stringify([{ product_id: AGUA, qty: 1 }]);

      for (let i = 0; i < 6; i++) {
        await c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`,
          [session_id, guest_id, `rajada-${i}`, item]);
      }

      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`,
          [session_id, guest_id, 'rajada-7', item]),
      ).rejects.toThrow(/Muitos pedidos/i);
    });
  });
});

// ===========================================================================
describe('§12.12 — promoção com estoque limitado', () => {
  it('promoção esgotada some do cardápio e o item sai pelo preço cheio', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      await c.query(
        `update promotions set used_quantity = max_quantity
          where id = '55555555-0000-4000-8000-000000000003'`);

      // sem estoque, a view deixa de oferecer a promoção — o cliente vê R$ 52
      const { rows: [vitrine] } = await c.query(
        `select promotion_id, effective_price_cents
           from product_effective_prices where product_id = $1`, [COSTELA]);
      expect(vitrine.promotion_id).toBeNull();
      expect(vitrine.effective_price_cents).toBe(5200);

      const obrigatorias = await opcoesObrigatorias(c, COSTELA);
      const { rows: [pedido] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`, [
          session_id, guest_id, 'idem-esgotou',
          JSON.stringify([{ product_id: COSTELA, qty: 1,
                            modifier_option_ids: obrigatorias }]),
        ]);

      const { rows: [item] } = await c.query(
        `select unit_price_cents, promotion_id from order_items where order_id = $1`,
        [pedido.id]);

      // exibido e cobrado continuam iguais — que é o que a §16 exige
      expect(item.unit_price_cents).toBe(5200);
      expect(item.promotion_id).toBeNull();
    });
  });

  it('esgotar ENTRE ver e enviar falha o pedido, em vez de cobrar mais calado', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);

      // resta 1 unidade: a promoção AINDA aparece no cardápio…
      await c.query(
        `update promotions set used_quantity = max_quantity - 1
          where id = '55555555-0000-4000-8000-000000000003'`);
      const { rows: [vitrine] } = await c.query(
        `select remaining_quantity from product_effective_prices where product_id = $1`,
        [COSTELA]);
      expect(vitrine.remaining_quantity).toBe(1);

      // …mas o cliente pede 2. Cobrar a diferença sem avisar quebraria a
      // promessa de que o preço exibido é o preço cobrado (spec §4).
      const obrigatorias = await opcoesObrigatorias(c, COSTELA);
      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, 'idem-corrida',
          JSON.stringify([{ product_id: COSTELA, qty: 2,
                            modifier_option_ids: obrigatorias }]),
        ]),
      ).rejects.toThrow(/promoção .* acabou/i);
    });
  });

  it('o estoque é decrementado pela quantidade pedida', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      const antes = await c.query(
        `select used_quantity from promotions where id = '55555555-0000-4000-8000-000000000003'`);

      const obrigatorias = await opcoesObrigatorias(c, COSTELA);
      await c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
        session_id, guest_id, 'idem-estoque',
        JSON.stringify([{ product_id: COSTELA, qty: 3,
                          modifier_option_ids: obrigatorias }]),
      ]);

      const depois = await c.query(
        `select used_quantity from promotions where id = '55555555-0000-4000-8000-000000000003'`);
      expect(depois.rows[0].used_quantity).toBe(antes.rows[0].used_quantity + 3);
    });
  });
});

// ===========================================================================
describe('§10.4 — escopo da sessão', () => {
  it('convidado de outra mesa não consegue lançar item', async () => {
    await emTransacao(async (c) => {
      const minha = await abrirComanda(c, 'Tereza', 'dev-a');

      // abre uma segunda mesa com outro cliente
      const { rows: [outraMesa] } = await c.query(
        `select short_code from restaurant_tables
          where restaurant_id = $1 and short_code <> $2 limit 1`,
        [RESTAURANTE_A, shortCode]);
      const { rows: [outra] } = await c.query(
        `select public.open_guest_session($1, 'Bruno', '', 'dev-b', false) as r`,
        [outraMesa.short_code]);

      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          minha.session_id, outra.r.guest_id, 'idem-invasao',
          JSON.stringify([{ product_id: AGUA, qty: 1 }]),
        ]),
      ).rejects.toThrow(/não pertence a esta mesa/i);
    });
  });

  it('indicar como comensal alguém de outra mesa é rejeitado', async () => {
    await emTransacao(async (c) => {
      const minha = await abrirComanda(c, 'Tereza', 'dev-a');
      const { rows: [outraMesa] } = await c.query(
        `select short_code from restaurant_tables
          where restaurant_id = $1 and short_code <> $2 limit 1`,
        [RESTAURANTE_A, shortCode]);
      const { rows: [outra] } = await c.query(
        `select public.open_guest_session($1, 'Bruno', '', 'dev-b', false) as r`,
        [outraMesa.short_code]);

      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          minha.session_id, minha.guest_id, 'idem-comensal',
          JSON.stringify([{ product_id: AGUA, qty: 1, guest_id: outra.r.guest_id }]),
        ]),
      ).rejects.toThrow(/não está nesta mesa/i);
    });
  });

  it('comanda fechada não aceita pedido', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      await c.query(`update table_sessions set status = 'closed' where id = $1`, [session_id]);

      await expect(
        c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`, [
          session_id, guest_id, 'idem-fechada',
          JSON.stringify([{ product_id: AGUA, qty: 1 }]),
        ]),
      ).rejects.toThrow(/não está aberta/i);
    });
  });
});

// ===========================================================================
describe('§4 — identificação do cliente', () => {
  it('o mesmo aparelho reaproveita a comanda e o cliente', async () => {
    await emTransacao(async (c) => {
      const primeira = await abrirComanda(c, 'Tereza', 'mesmo-aparelho');
      const segunda = await abrirComanda(c, 'Tereza', 'mesmo-aparelho');

      expect(segunda.session_id).toBe(primeira.session_id);
      expect(segunda.guest_id).toBe(primeira.guest_id);
    });
  });

  it('aparelhos diferentes na mesma mesa são pessoas diferentes', async () => {
    await emTransacao(async (c) => {
      const a = await abrirComanda(c, 'Tereza', 'aparelho-1');
      const b = await abrirComanda(c, 'Bruno', 'aparelho-2');

      expect(b.session_id).toBe(a.session_id); // mesma comanda
      expect(b.guest_id).not.toBe(a.guest_id); // pessoas distintas
    });
  });

  it('nome vazio é rejeitado', async () => {
    await emTransacao(async (c) => {
      await expect(
        c.query(`select public.open_guest_session($1, '   ', '', 'dev', false)`, [shortCode]),
      ).rejects.toThrow(/nome/i);
    });
  });

  it('LGPD — telefone sem consentimento não é gravado', async () => {
    await emTransacao(async (c) => {
      const { rows: [r] } = await c.query(
        `select public.open_guest_session($1, 'Tereza', '11998887766', 'dev-sem', false) as r`,
        [shortCode]);

      const { rows: [g] } = await c.query(
        `select phone, lgpd_consent_at from session_guests where id = $1`, [r.r.guest_id]);

      expect(g.phone).toBeNull();
      expect(g.lgpd_consent_at).toBeNull();
    });
  });

  it('LGPD — com consentimento, telefone e timestamp são gravados', async () => {
    await emTransacao(async (c) => {
      const { rows: [r] } = await c.query(
        `select public.open_guest_session($1, 'Tereza', '(11) 99888-7766', 'dev-com', true) as r`,
        [shortCode]);

      const { rows: [g] } = await c.query(
        `select phone, lgpd_consent_at from session_guests where id = $1`, [r.r.guest_id]);

      // máscara removida na entrada
      expect(g.phone).toBe('11998887766');
      expect(g.lgpd_consent_at).not.toBeNull();
    });
  });

  it('require_phone torna o telefone obrigatório', async () => {
    await emTransacao(async (c) => {
      await c.query(`update restaurants set require_phone = true where id = $1`, [RESTAURANTE_A]);
      await expect(
        c.query(`select public.open_guest_session($1, 'Tereza', '', 'dev', false)`, [shortCode]),
      ).rejects.toThrow(/telefone/i);
    });
  });

  it('require_waiter_to_open_table bloqueia a abertura pelo cliente', async () => {
    await emTransacao(async (c) => {
      await c.query(
        `update restaurants set require_waiter_to_open_table = true where id = $1`,
        [RESTAURANTE_A]);
      await expect(
        c.query(`select public.open_guest_session($1, 'Tereza', '', 'dev', false)`, [shortCode]),
      ).rejects.toThrow(/garçom/i);
    });
  });
});

// ===========================================================================
describe('§16 — o pedido não chega na cozinha sem aprovação', () => {
  it('itens nascem pending e o pedido, pending_approval', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      const { rows: [pedido] } = await c.query(
        `select public.create_guest_order($1, $2, $3, $4::jsonb) as id`,
        [session_id, guest_id, 'idem-fila', JSON.stringify([{ product_id: AGUA, qty: 1 }])]);

      const { rows: [o] } = await c.query(`select status from orders where id = $1`, [pedido.id]);
      expect(o.status).toBe('pending_approval');

      const { rows: itens } = await c.query(
        `select status, queued_at from order_items where order_id = $1`, [pedido.id]);
      expect(itens[0].status).toBe('pending');
      // o cronômetro só começa na aprovação do garçom
      expect(itens[0].queued_at).toBeNull();
    });
  });

  it('o item pendente não entra no subtotal cobrável', async () => {
    await emTransacao(async (c) => {
      const { session_id, guest_id } = await abrirComanda(c);
      await c.query(`select public.create_guest_order($1, $2, $3, $4::jsonb)`,
        [session_id, guest_id, 'idem-subtotal',
         JSON.stringify([{ product_id: AGUA, qty: 2 }])]);

      const { rows: [t] } = await c.query(
        `select subtotal_cents, pending_cents from session_totals where session_id = $1`,
        [session_id]);

      expect(t.subtotal_cents).toBe(0);
      expect(t.pending_cents).toBe(1400);
    });
  });
});
