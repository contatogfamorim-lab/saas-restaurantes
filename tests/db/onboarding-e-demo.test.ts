/**
 * Configuração inicial e demonstração (migrations 0034 e 0035).
 *
 * O que precisa ser verdade:
 *
 *   1. o sistema NÃO inventa preço. O cardápio gerado nasce a R$ 0,00 e fora do
 *      ar — a única regra deste projeto que vale mais que conveniência;
 *   2. rodar duas vezes não duplica nada. Alguém VAI rodar duas vezes;
 *   3. o que o cliente manda não vale: taxa de 900% vira o teto, não 900%;
 *   4. a marca de "configuração inicial respondido" é PERMANENTE, mas as respostas somem em
 *      3 horas. Confundir as duas faz o restaurante ser barrado na porta toda
 *      madrugada — foi o bug que este arquivo existe para travar;
 *   5. a demo expira e leva o restaurante inteiro junto; o restaurante de
 *      verdade, ao lado dela, não é tocado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const DONO = 'dddddddd-0000-4000-8000-000000000001';
const GARCOM = 'dddddddd-0000-4000-8000-000000000002';

let pool: Pool;

/** Abre uma transação como `authenticated` com o `sub` dado, e desfaz no fim. */
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

async function criarUsuario(id: string, email: string) {
  await pool.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                             email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                             created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
             $2, extensions.crypt('x', extensions.gen_salt('bf', 4)), now(),
             '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
     on conflict (id) do nothing`,
    [id, email],
  );
}

/** Cria um restaurante novo pela porta real e devolve o id. */
async function novoRestaurante(c: Client, nome: string): Promise<string> {
  await c.query(`select public.create_restaurant($1, 'Dona da casa')`, [nome]);
  const { rows } = await c.query(`select app.current_restaurant_id() as id`);
  return rows[0].id as string;
}

const RESPOSTAS = {
  tipo_cozinha: 'hamburgueria',
  cidade: 'Belo Horizonte',
  timezone: 'America/Sao_Paulo',
  mesas: 12,
  taxa_servico: 10,
  pedir_telefone: false,
};

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

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await criarUsuario(DONO, 'dona@configuração inicial.test');
  await criarUsuario(GARCOM, 'garcom@configuração inicial.test');
});

afterAll(async () => {
  await pool
    ?.query(`delete from auth.users where id = any($1::uuid[])`, [[DONO, GARCOM]])
    .catch(() => {});
  await pool?.end();
});

// ===========================================================================
describe('0059 — as configurações iniciais montam o que foi RESPONDIDO', () => {
  it('NÃO gera cardápio nenhum — o sistema não sabe o que a casa vende', async () => {
    // Este teste já foi o oposto: exigia que a configuração inicial gerasse dez pratos de
    // hamburgueria, sem preço e fora do ar. A intenção era boa (tela vazia é
    // ruim de encarar) e a consequência não: o dono abria o editor e encontrava
    // dez pratos que não vende, e o primeiro trabalho dele com o produto era
    // APAGAR.
    //
    // O sistema conhece o cardápio que uma hamburgueria GENÉRICA costuma ter.
    // Isso não é o cardápio daquela casa, e fingir que é quebra a mesma regra
    // que o resto do projeto respeita: o servidor não sabe o que o dono sabe.
    //
    // O que vem pronto agora é DEMONSTRAÇÃO, e ela some em três horas.
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Casa Vazia');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [
        JSON.stringify(RESPOSTAS),
      ]);

      const { rows } = await c.query(
        `select (select count(*) from public.products where restaurant_id = $1)::int as produtos,
                (select count(*) from public.categories where restaurant_id = $1)::int as categorias,
                (select count(*) from public.restaurant_tables where restaurant_id = $1)::int as mesas`,
        [restaurante],
      );

      expect(rows[0].produtos).toBe(0);
      expect(rows[0].categorias).toBe(0);
      // O que ELA respondeu, sim: as mesas foram criadas.
      expect(rows[0].mesas).toBeGreaterThan(0);
    });
  });

  it('rodar duas vezes não muda nada de novo', async () => {
    // Era "não duplica categoria nem produto", e não há mais nem um nem outro.
    // O que sobra para não duplicar são as mesas — e é o que importa: mesa
    // duplicada é QR duplicado, e QR duplicado é cliente sentado na mesa errada.
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Duas Vezes');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [
        JSON.stringify(RESPOSTAS),
      ]);
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [
        JSON.stringify(RESPOSTAS),
      ]);

      const { rows } = await c.query(
        `select count(*)::int as n from public.restaurant_tables where restaurant_id = $1`,
        [restaurante],
      );
      expect(rows[0].n).toBe(RESPOSTAS.mesas);
    });
  });

  it('as mesas COMPLETAM o que falta, não somam de novo', async () => {
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Configuração inicial Mesas');
      await c.query(`select public.create_tables(8, 'Salão')`);

      const r = await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb) as r`, [
        JSON.stringify({ ...RESPOSTAS, mesas: 12 }),
      ]);
      expect(r.rows[0].r.mesas_criadas).toBe(4);

      const { rows } = await c.query(
        `select count(*)::int as n from public.restaurant_tables where restaurant_id = $1`,
        [restaurante],
      );
      expect(rows[0].n).toBe(12);
    });
  });

  it('taxa de serviço absurda é apertada no servidor, não aceita', async () => {
    // §10.1: o servidor nunca confia no cliente. O Zod da Server Action é a
    // mensagem bonita; ESTA é a proteção.
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Configuração inicial Ganancioso');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [
        JSON.stringify({ ...RESPOSTAS, taxa_servico: 900, mesas: 99999 }),
      ]);

      const { rows } = await c.query(
        `select service_fee_pct::float8 as taxa,
                (select count(*)::int from public.restaurant_tables
                  where restaurant_id = r.id) as mesas
           from public.restaurants r where r.id = $1`,
        [restaurante],
      );
      expect(rows[0].taxa).toBe(30);
      expect(rows[0].mesas).toBe(200);
    });
  });

  it('quem não administra não faz as configurações iniciais', async () => {
    await como(DONO, async (c) => {
      await novoRestaurante(c, 'Configuração inicial Fechado');
      await c.query(
        `insert into public.profiles (id, restaurant_id, name, roles, active)
         values ($1, app.current_restaurant_id(), 'Garçom', array['waiter']::public.staff_role[], true)`,
        [GARCOM],
      );

      // Troca de ator DENTRO da mesma transação: o restaurante existe, o garçom
      // pertence a ele, e mesmo assim a porta é fechada.
      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [GARCOM],
      );

      await esperaFalhar(
        c,
        `select public.aplicar_configuracoes_iniciais($1::jsonb)`,
        [JSON.stringify(RESPOSTAS)],
        /administra o restaurante/i,
      );
    });
  });

  it('a marca de respondido é permanente; as respostas é que expiram', async () => {
    // O bug que isto trava: usar a existência da linha em `restaurant_briefing`
    // como porteiro. Ela some em 3 horas de propósito — e o restaurante seria
    // interrogado de novo toda madrugada sobre que tipo de comida ele vende.
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Configuração inicial Duradouro');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [JSON.stringify(RESPOSTAS)]);

      // envelhece as respostas e roda a limpeza
      await c.query(
        `update public.restaurant_briefing set expires_at = now() - interval '1 minute'
          where restaurant_id = $1`,
        [restaurante],
      );
      await c.query(`set local role postgres`);
      await c.query(`select app.limpar_demos_vencidas()`);

      const { rows } = await c.query(
        `select (select count(*)::int from public.restaurant_briefing
                  where restaurant_id = r.id) as respostas,
                (r.briefing_at is not null) as marcado,
                (r.id is not null) as vivo
           from public.restaurants r where r.id = $1`,
        [restaurante],
      );

      expect(rows[0].respostas).toBe(0); // as respostas sumiram
      expect(rows[0].marcado).toBe(true); // a marca ficou
      expect(rows[0].vivo).toBe(true); // e o restaurante não foi junto
    });
  });
});

// ===========================================================================
describe('0035 — a demonstração', () => {
  /** Monta um restaurante com configuração inicial e demo, e devolve o id. */
  async function comDemo(c: Client, nome: string): Promise<string> {
    const restaurante = await novoRestaurante(c, nome);
    await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [JSON.stringify(RESPOSTAS)]);
    await c.query(`select public.gerar_demonstracao()`);
    return restaurante;
  }

  it('põe preço e movimento: quatro mesas ocupadas, uma esperando aprovação', async () => {
    await como(DONO, async (c) => {
      const restaurante = await comDemo(c, 'Demo Movimento');

      const { rows } = await c.query(
        `select (select count(*)::int from public.products
                  where restaurant_id = $1 and price_cents = 0) as sem_preco,
                (select count(*)::int from public.table_sessions
                  where restaurant_id = $1 and status = 'open') as mesas_abertas,
                (select count(*)::int from public.orders
                  where restaurant_id = $1 and status = 'pending_approval') as esperando,
                (select count(*)::int from public.order_items oi
                   join public.orders o on o.id = oi.order_id
                  where o.restaurant_id = $1 and oi.status = 'ready') as na_passagem,
                (select count(*)::int from public.waiter_calls
                  where restaurant_id = $1 and resolved_at is null) as chamados`,
        [restaurante],
      );

      expect(rows[0].sem_preco).toBe(0);
      expect(rows[0].mesas_abertas).toBe(4);
      expect(rows[0].esperando).toBe(1);
      expect(rows[0].na_passagem).toBe(1);
      expect(rows[0].chamados).toBe(2);
    });
  });

  it('a mesa que já está em produção NÃO aparece na fila de aprovação', async () => {
    // Duas telas do mesmo sistema contando histórias diferentes é o defeito que
    // mais rápido derruba a credibilidade de uma demonstração: o mapa dizia
    // "pedido novo" numa mesa cujo prato já estava na chapa.
    await como(DONO, async (c) => {
      await comDemo(c, 'Demo Coerente');
      const { rows } = await c.query(`select count(*)::int as n from public.approval_queue`);
      expect(rows[0].n).toBe(1);
    });
  });

  it('as observações caem em PRATO PRINCIPAL, e nada de bar vai para a cozinha', async () => {
    // Regressão de "Brownie com Sorvete | SEM CEBOLA".
    //
    // A primeira asserção que escrevi aqui era fraca: pedia só que a estação
    // fosse `cozinha`. Sabotei a função de volta para a ordem alfabética e o
    // teste PASSOU — porque "Batata frita" também é cozinha. O bug estava na
    // tela e o teste dizia verde.
    //
    // As duas invariantes que a correção realmente estabelece:
    //   1. nenhum item de BAR entra na comanda (a versão com bug mandava uma
    //      garrafa de água para a chapa);
    //   2. as observações caem na PRIMEIRA categoria — os pratos principais.
    await como(DONO, async (c) => {
      const restaurante = await comDemo(c, 'Demo Sem Cebola');

      const { rows: bar } = await c.query(
        `select count(*)::int as n from public.order_items oi
           join public.orders o on o.id = oi.order_id
          where o.restaurant_id = $1 and oi.station <> 'cozinha'`,
        [restaurante],
      );
      expect(bar[0].n).toBe(0);

      const { rows } = await c.query(
        `select m.option_name, oi.notes, p.name as prato, c.name as categoria,
                c.sort_order,
                (select min(sort_order) from public.categories
                  where restaurant_id = $1 and station = 'cozinha') as primeira
           from public.order_items oi
           join public.orders o on o.id = oi.order_id
           join public.products p on p.id = oi.product_id
           join public.categories c on c.id = p.category_id
           left join public.order_item_modifiers m on m.order_item_id = oi.id
          where o.restaurant_id = $1
            and (m.option_name is not null or oi.notes is not null)`,
        [restaurante],
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const linha of rows) {
        expect(linha.sort_order).toBe(linha.primeira);
      }
    });
  });

  it('ocupa as QUATRO PRIMEIRAS mesas, e não a 1, a 10, a 2 e a 3', async () => {
    // `order by label` é alfabético. Com 10 mesas ele dá "Mesa 1", "Mesa 10",
    // "Mesa 2", "Mesa 3" — e o mapa do salão anunciava "4 de 10 ocupadas" com a
    // Mesa 4 vazia. Foi visto na tela, não no teste: a versão anterior deste
    // arquivo usava 12 mesas e conferia só a CONTAGEM, então passava.
    //
    // Dez mesas de propósito: com menos de dez não existem dois dígitos e o
    // alfabético coincide com o numérico. O bug precisa de 10 para aparecer.
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Demo Dez Mesas');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [
        JSON.stringify({ ...RESPOSTAS, mesas: 10 }),
      ]);
      await c.query(`select public.gerar_demonstracao()`);

      const { rows } = await c.query(
        `select t.label, (s.id is not null) as ocupada
           from public.restaurant_tables t
           left join public.table_sessions s
             on s.table_id = t.id and s.status = 'open'
          where t.restaurant_id = $1
          order by (substring(t.label from '[0-9]+'))::int`,
        [restaurante],
      );

      expect(rows.map((r) => r.label)).toHaveLength(10);
      expect(rows.slice(0, 4).map((r) => r.ocupada)).toEqual([true, true, true, true]);
      expect(rows.slice(4).every((r) => r.ocupada === false)).toBe(true);
    });
  });

  it('expira levando tudo, e não encosta no restaurante de verdade ao lado', async () => {
    await como(DONO, async (c) => {
      const demo = await comDemo(c, 'Demo Efemera');

      // um restaurante de verdade, criado pela mesma porta, sem prazo
      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [GARCOM],
      );
      const real = await novoRestaurante(c, 'Casa Permanente');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [
        JSON.stringify(RESPOSTAS),
      ]);

      // O CARDÁPIO DELA É CRIADO À MÃO, e a mudança é o ponto.
      //
      // Antes, `aplicar_configuracoes_iniciais` inventava um cardápio e a fixture ganhava
      // produtos de graça. Desde a 0059 restaurante de verdade nasce vazio — e
      // sem estas linhas o teste passaria a comparar "zero produtos antes" com
      // "zero produtos depois", que é verdade por vacuidade e não prova que a
      // faxina respeitou o vizinho.
      await c.query(`set local role postgres`);
      const { rows: cat } = await c.query(
        `insert into public.categories (restaurant_id, name, sort_order, station)
         values ($1, 'Pratos', 1, 'cozinha') returning id`,
        [real],
      );
      await c.query(
        `insert into public.products (restaurant_id, category_id, name, price_cents)
         values ($1, $2, 'Prato da casa', 3500)`,
        [real, cat[0].id],
      );
      await c.query(`update public.restaurants set expires_at = now() - interval '1 minute'
                      where id = $1`, [demo]);

      const { rows: limpou } = await c.query(`select app.limpar_demos_vencidas() as n`);
      expect(limpou[0].n).toBe(1);

      const { rows } = await c.query(
        `select (select count(*)::int from public.restaurants where id = $1) as demo_viva,
                (select count(*)::int from public.orders where restaurant_id = $1) as pedidos,
                (select count(*)::int from public.restaurant_tables where restaurant_id = $1) as mesas,
                (select count(*)::int from public.restaurants where id = $2) as real_viva,
                (select count(*)::int from public.products where restaurant_id = $2) as real_cardapio`,
        [demo, real],
      );

      expect(rows[0].demo_viva).toBe(0);
      expect(rows[0].pedidos).toBe(0);
      expect(rows[0].mesas).toBe(0);
      expect(rows[0].real_viva).toBe(1);
      expect(rows[0].real_cardapio).toBeGreaterThan(0);

      /*
       * A DEMONSTRAÇÃO NÃO DEIXA RASTRO: perfil E conta de login somem (0061).
       *
       * A 0036 tinha decidido o contrário — preservar o login para poupar um
       * segundo ida-e-volta na confirmação de e-mail. A decisão foi revertida.
       *
       * E a ressalva importa tanto quanto a regra: o GARÇOM é dono do
       * restaurante de verdade deste mesmo teste, e a conta dele TEM que
       * sobreviver. A 0034 fazia esta faxina sem esse cuidado e apagaria quem
       * criasse uma demonstração para mostrar a alguém.
       */
      const { rows: conta } = await c.query(
        `select (select count(*)::int from public.profiles where id = $1) as perfil,
                (select count(*)::int from auth.users where id = $1) as login,
                (select count(*)::int from auth.users where id = $2) as login_vizinho,
                (select count(*)::int from public.profiles where id = $2) as perfil_vizinho`,
        [DONO, GARCOM],
      );
      expect(conta[0].perfil).toBe(0);
      expect(conta[0].login).toBe(0);

      expect(conta[0].perfil_vizinho).toBe(1);
      expect(conta[0].login_vizinho).toBe(1);
    });
  });

  it('restaurante de verdade NUNCA ganha prazo de validade', async () => {
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Casa Sem Prazo');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [JSON.stringify(RESPOSTAS)]);

      const { rows } = await c.query(
        `select expires_at from public.restaurants where id = $1`,
        [restaurante],
      );
      expect(rows[0].expires_at).toBeNull();
    });
  });

  it('quem não administra não gera demonstração', async () => {
    await como(DONO, async (c) => {
      await novoRestaurante(c, 'Demo Fechada');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [JSON.stringify(RESPOSTAS)]);
      await c.query(
        `insert into public.profiles (id, restaurant_id, name, roles, active)
         values ($1, app.current_restaurant_id(), 'Garçom', array['waiter']::public.staff_role[], true)`,
        [GARCOM],
      );
      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [GARCOM],
      );

      await esperaFalhar(c, `select public.gerar_demonstracao()`, [], /administra/i);
    });
  });
});

// ===========================================================================
describe('a fresta na imutabilidade do audit_log', () => {
  // A limpeza da demo precisou de UMA exceção no `append-only`. Estes três
  // casos existem para que ela permaneça do tamanho que foi aberta — a fresta
  // que ninguém vigia é a que vira porta.

  it('o dono NÃO apaga o próprio rastro num restaurante de verdade', async () => {
    // São DUAS camadas, e o dono esbarra na primeira: ele não tem GRANT de
    // DELETE em `audit_log`, então nem chega ao trigger. Aceito as duas
    // mensagens de propósito — o que este teste guarda é que a linha não sai,
    // não QUAL camada a segurou. Amarrar na mensagem faria o teste quebrar no
    // dia em que a defesa ficasse mais forte.
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Auditoria Firme');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [JSON.stringify(RESPOSTAS)]);

      await esperaFalhar(
        c,
        `delete from public.audit_log where restaurant_id = $1`,
        [restaurante],
        /append-only|permission denied/i,
      );

      const { rows } = await c.query(
        `select count(*)::int as n from public.audit_log where restaurant_id = $1`,
        [restaurante],
      );
      expect(rows[0].n).toBeGreaterThan(0);
    });
  });

  it('nem o postgres apaga: a trava é do banco, não da permissão', async () => {
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Auditoria Firme 2');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [JSON.stringify(RESPOSTAS)]);
      await c.query(`set local role postgres`);

      await esperaFalhar(
        c,
        `delete from public.audit_log where restaurant_id = $1`,
        [restaurante],
        /append-only/i,
      );
    });
  });

  it('demonstração DENTRO do prazo também é imutável', async () => {
    // A fresta é "demo vencida", não "demo". Uma demo viva tem rastro tão
    // intocável quanto o de uma casa de verdade.
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Auditoria Demo Viva');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [JSON.stringify(RESPOSTAS)]);
      // O PRAZO vem de `marcar_como_demonstracao`, e não de `gerar_demonstracao`
      // — desde a 0046. A geração é uma transação só, e uma falha nela desfaria
      // o `expires_at` junto com o resto; a marca precisa vir de fora.
      await c.query(`select public.marcar_como_demonstracao()`);
      await c.query(`select public.gerar_demonstracao()`);
      await c.query(`set local role postgres`);

      const { rows } = await c.query(
        `select expires_at > now() as no_prazo from public.restaurants where id = $1`,
        [restaurante],
      );
      expect(rows[0].no_prazo).toBe(true);

      await esperaFalhar(
        c,
        `delete from public.audit_log where restaurant_id = $1`,
        [restaurante],
        /append-only/i,
      );
    });
  });

  it('UPDATE segue proibido mesmo em demonstração vencida', async () => {
    await como(DONO, async (c) => {
      const restaurante = await novoRestaurante(c, 'Auditoria Sem Update');
      await c.query(`select public.aplicar_configuracoes_iniciais($1::jsonb)`, [JSON.stringify(RESPOSTAS)]);
      await c.query(`set local role postgres`);
      await c.query(
        `update public.restaurants set expires_at = now() - interval '1 minute' where id = $1`,
        [restaurante],
      );

      await esperaFalhar(
        c,
        `update public.audit_log set action = 'mentira' where restaurant_id = $1`,
        [restaurante],
        /append-only/i,
      );
    });
  });
});
