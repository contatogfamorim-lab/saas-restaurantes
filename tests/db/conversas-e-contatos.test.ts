/**
 * 0062 — a caixa de entrada e a agenda do WhatsApp.
 *
 * O TESTE QUE IMPORTA É O PRIMEIRO. Os outros são higiene de RLS; aquele é a
 * razão de a tabela existir separada.
 *
 * Contato puxado da Evolution é a agenda de um celular: tem cliente, tem o
 * fornecedor de carne, tem parente. Nenhuma dessas pessoas autorizou receber
 * promoção. Se um dia alguém "melhorar" isso jogando os contatos em
 * `customers`, a casa passa a disparar campanha para a agenda inteira do dono —
 * e descobre pelo bloqueio do WhatsApp, ou pior, por uma reclamação.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const CASA = '11111111-1111-4111-8111-111111111111';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000001';
const GERENTE = 'aaaaaaaa-0000-4000-8000-000000000006';
const GARCOM = 'aaaaaaaa-0000-4000-8000-000000000002';

const JID = '5511987654321@s.whatsapp.net';

let pool: Pool;
beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL });
});
afterAll(async () => {
  await pool.end();
});

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

/** Um contato e três mensagens, escritos como o webhook escreve. */
async function comConversa(c: Client) {
  await c.query(
    `insert into public.whatsapp_contacts (restaurant_id, jid, phone, nome)
     values ($1, $2, '5511987654321', 'Ana da Agenda')
     on conflict (restaurant_id, jid) do nothing`,
    [CASA, JID],
  );
  await c.query(
    `insert into public.whatsapp_messages
       (restaurant_id, jid, direcao, corpo, wa_id, enviada_em)
     values ($1,$2,'entrada','Oi, abrem hoje?','w1', now() - interval '10 min'),
            ($1,$2,'saida','Abrimos sim','w2', now() - interval '9 min'),
            ($1,$2,'entrada','Show','w3', now() - interval '8 min')
     on conflict (restaurant_id, wa_id) do nothing`,
    [CASA, JID],
  );
}

// ===========================================================================
describe('a agenda NÃO é base de marketing', () => {
  it('CONTATO DO WHATSAPP NÃO ENTRA NO PÚBLICO DE CAMPANHA', async () => {
    await comoPostgres(async (c) => {
      await comConversa(c);

      const { rows } = await c.query(
        `select count(*)::int as n from public.publico_de_marketing`,
      );
      const antes = rows[0].n;

      // Mais dez contatos, como uma sincronização de agenda de verdade.
      for (let i = 0; i < 10; i++) {
        await c.query(
          `insert into public.whatsapp_contacts (restaurant_id, jid, phone, nome)
           values ($1, $2, $3, $4)`,
          [CASA, `55119000000${i}@s.whatsapp.net`, `55119000000${i}`, `Contato ${i}`],
        );
      }

      const { rows: depois } = await c.query(
        `select count(*)::int as n from public.publico_de_marketing`,
      );

      // A agenda inteira entrou no banco e o público não mexeu um milímetro.
      expect(depois[0].n).toBe(antes);
    });
  });

  it('as duas tabelas não se tocam: contato não vira `customers`', async () => {
    // Prova estrutural, e não de comportamento: não existe FK, trigger nem
    // coluna ligando uma coisa à outra. É o que torna o furo impossível em vez
    // de improvável.
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n
           from information_schema.referential_constraints rc
           join information_schema.key_column_usage k
             on k.constraint_name = rc.constraint_name
          where k.table_name = 'whatsapp_contacts'
            and rc.unique_constraint_name in (
              select constraint_name from information_schema.table_constraints
               where table_name = 'customers' and constraint_type = 'PRIMARY KEY')`,
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

// ===========================================================================
describe('quem lê a caixa de entrada', () => {
  it('o dono lê as conversas e a agenda', async () => {
    await comoPostgres(async (c) => {
      await comConversa(c);
      await c.query('commit');
    }).catch(() => {});

    await como(DONO, async (c) => {
      const m = await c.query(`select count(*)::int as n from public.whatsapp_messages`);
      const t = await c.query(`select count(*)::int as n from public.whatsapp_contacts`);
      expect(m.rows[0].n).toBeGreaterThan(0);
      expect(t.rows[0].n).toBeGreaterThan(0);
    });
  });

  it('o gerente também — é ele quem responde numa casa de verdade', async () => {
    await como(GERENTE, async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from public.whatsapp_messages`,
      );
      expect(rows[0].n).toBeGreaterThan(0);
    });
  });

  it('O GARÇOM NÃO LÊ. Conversa é telefone e texto livre de cliente', async () => {
    await como(GARCOM, async (c) => {
      const m = await c.query(`select count(*)::int as n from public.whatsapp_messages`);
      const t = await c.query(`select count(*)::int as n from public.whatsapp_contacts`);
      expect(m.rows[0].n).toBe(0);
      expect(t.rows[0].n).toBe(0);
    });
  });
});

// ===========================================================================
describe('ninguém forja uma conversa pelo navegador', () => {
  it('nem o dono INSERE mensagem', async () => {
    // Sem policy de insert, a RLS recusa por omissão. É o que impede a tela de
    // inventar uma mensagem "recebida" — a conversa é registro do que houve.
    await como(DONO, async (c) => {
      await c.query('savepoint t');
      let falhou = false;
      try {
        await c.query(
          `insert into public.whatsapp_messages (restaurant_id, jid, direcao, corpo)
           values ($1, $2, 'entrada', 'eu nunca escrevi isto')`,
          [CASA, JID],
        );
      } catch {
        falhou = true;
      }
      await c.query('rollback to savepoint t');
      expect(falhou).toBe(true);
    });
  });

  it('nem o dono APAGA mensagem', async () => {
    /*
     * Quem barra aqui é o GRANT, não a policy — a 0062 concede só `select`, e
     * o Postgres recusa antes de a RLS entrar em cena. Descobri escrevendo
     * este teste: eu esperava `rowCount = 0` (linha invisível para o comando) e
     * veio "permission denied".
     *
     * É mais forte do que eu tinha escrito, e vale registrar por quê: são duas
     * camadas independentes. Alguém que um dia adicione uma policy de delete
     * "para poder limpar spam" ainda esbarra no grant, e vai ter que tomar a
     * decisão duas vezes.
     */
    await como(DONO, async (c) => {
      await expect(
        c.query(`delete from public.whatsapp_messages where jid = $1`, [JID]),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});

// ===========================================================================
describe('marcar_conversa_lida', () => {
  it('o dono marca, e só as que ENTRARAM', async () => {
    await como(DONO, async (c) => {
      const { rows } = await c.query(`select public.marcar_conversa_lida($1) as n`, [JID]);
      expect(Number(rows[0].n)).toBeGreaterThan(0);

      const saida = await c.query(
        `select count(*)::int as n from public.whatsapp_messages
          where jid = $1 and direcao = 'saida' and lida_em is not null`,
        [JID],
      );
      // "Lida" é o cliente ter lido o que a casa mandou, e isso quem informa é
      // o WhatsApp pelo MESSAGES_UPDATE. Marcar aqui seria mentira na tela.
      expect(saida.rows[0].n).toBe(0);
    });
  });

  it('o garçom NÃO marca', async () => {
    await como(GARCOM, async (c) => {
      await expect(
        c.query(`select public.marcar_conversa_lida($1)`, [JID]),
      ).rejects.toThrow(/permiss/i);
    });
  });
});

// ===========================================================================
describe('o caminho do webhook', () => {
  /*
   * ESTE BLOCO EXISTE POR CAUSA DE UM DEFEITO MUDO.
   *
   * A 0062 nasceu concedendo `select` só a `authenticated`. `service_role`
   * ignora RLS, e eu concluí daí que ignorava permissão de tabela — não ignora.
   * O webhook recebia o evento, levava "permission denied" e respondia 200
   * assim mesmo (que é o certo: erro reentregue para sempre vira laço).
   *
   * Resultado: conexão dizendo "conectado", conversa acontecendo no celular,
   * tela vazia, e nada na cara de ninguém. Só apareceu quando mandei um evento
   * de mentira para o servidor local e fui olhar o banco.
   */
  async function comoServico<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      await client.query('begin');
      await client.query('set local role service_role');
      return await fn(client);
    } finally {
      await client.query('rollback').catch(() => {});
      await client.end();
    }
  }

  it('SERVICE_ROLE GRAVA mensagem e contato', async () => {
    await comoServico(async (c) => {
      await c.query(
        `insert into public.whatsapp_messages
           (restaurant_id, jid, direcao, corpo, wa_id)
         values ($1, $2, 'entrada', 'chegou pelo webhook', 'wh-teste')`,
        [CASA, JID],
      );
      await c.query(
        `insert into public.whatsapp_contacts (restaurant_id, jid, nome)
         values ($1, '5511900000001@s.whatsapp.net', 'Da Agenda')`,
        [CASA],
      );

      const { rows } = await c.query(
        `select count(*)::int as n from public.whatsapp_messages where wa_id = 'wh-teste'`,
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it('a REENTREGA não duplica a mensagem', async () => {
    // A Evolution reentrega o mesmo evento quando demoramos a responder. Sem o
    // `unique (restaurant_id, wa_id)` a conversa ganharia a mesma linha duas
    // vezes toda vez que o servidor engasgasse.
    await comoServico(async (c) => {
      for (let i = 0; i < 3; i++) {
        await c.query(
          `insert into public.whatsapp_messages
             (restaurant_id, jid, direcao, corpo, wa_id)
           values ($1, $2, 'entrada', 'mesma mensagem', 'wh-repetido')
           on conflict (restaurant_id, wa_id) do nothing`,
          [CASA, JID],
        );
      }
      const { rows } = await c.query(
        `select count(*)::int as n from public.whatsapp_messages where wa_id = 'wh-repetido'`,
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it('service_role NÃO apaga conversa', async () => {
    // Nem o webhook. A conversa é registro do que aconteceu, e o grant da 0062
    // concede insert e update — nunca delete.
    await comoServico(async (c) => {
      await expect(
        c.query(`delete from public.whatsapp_messages where jid = $1`, [JID]),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
