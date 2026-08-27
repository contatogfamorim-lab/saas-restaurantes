/**
 * A fila de campanhas (migration 0050).
 *
 * O que precisa ser verdade:
 *
 *   1. quem saiu da lista DEPOIS da montagem não recebe. É a diferença entre
 *      este sistema e o CRM de onde a fila veio, e é a única propriedade aqui
 *      cujo erro não tem desfazer;
 *   2. o link de saída está em toda mensagem, sem depender de quem escreveu;
 *   3. o texto é congelado por destinatário — editar a campanha não reescreve
 *      o que já foi mandado;
 *   4. duas rodadas simultâneas não mandam a mesma mensagem duas vezes;
 *   5. o telefone não sai para a equipe por esta porta;
 *   6. o teto do dia segura, e segura sem marcar ninguém como falho;
 *   7. sem WhatsApp conectado, nada dispara;
 *   8. garçom não escreve campanha, e ninguém insere destinatário à mão.
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

function cpf() {
  return String(Math.floor(10_000_000_000 + Math.random() * 89_999_999_999));
}

/** Um cliente que aceitou receber. É o insumo de quase todo teste daqui. */
async function clienteAceito(c: Client, nome = 'Joana Silva'): Promise<string> {
  const { rows } = await c.query(
    `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
     values ($1, $2, $3, '11999990000', 'x') returning id`,
    [RESTAURANTE, cpf(), nome],
  );
  await c.query(`select public.aceitar_marketing($1)`, [rows[0].id]);
  return rows[0].id;
}

/** WhatsApp conectado — sem isto `iniciar_campanha` recusa, e deve recusar. */
async function conectaWhats(c: Client) {
  await c.query(
    `update public.restaurants set evolution_instance_name = 'teste' where id = $1`,
    [RESTAURANTE],
  );
}

async function novaCampanha(
  c: Client,
  corpo = 'Oi {nome}, seu saldo é {saldo}. Aparece hoje!',
): Promise<string> {
  const { rows } = await c.query(
    `insert into public.message_campaigns (restaurant_id, titulo, corpo)
     values ($1, 'Teste', $2) returning id`,
    [RESTAURANTE, corpo],
  );
  return rows[0].id;
}

/** Monta público e dispara, como o dono faria. Devolve quantos entraram. */
async function montaEDispara(c: Client, campanha: string): Promise<number> {
  await viraStaff(c, DONO);
  const { rows } = await c.query(`select public.montar_publico($1) as n`, [campanha]);
  await c.query(`select public.iniciar_campanha($1)`, [campanha]);
  await c.query('reset role');
  return rows[0].n;
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
});
afterAll(async () => {
  await pool.end();
});

describe('quem saiu da lista não recebe', () => {
  it('sair DEPOIS da montagem impede o envio', async () => {
    // O cenário exato que separa este sistema do CRM de origem: o público é
    // montado, a pessoa clica em "sair", e só então o worker chega nela.
    await comoPostgres(async (c) => {
      const cliente = await clienteAceito(c);
      await conectaWhats(c);
      const campanha = await novaCampanha(c);
      expect(await montaEDispara(c, campanha)).toBe(1);

      // Ela sai. É o clique da página /sair.
      const { rows: t } = await c.query(
        `select unsubscribe_token as tok from public.customers where id = $1`,
        [cliente],
      );
      await c.query(`select public.descadastrar_marketing($1)`, [t[0].tok]);

      // O worker chega. Não pode haver nada para mandar.
      const { rows } = await c.query(`select * from public.reservar_proximo_envio()`);
      expect(rows).toHaveLength(0);

      // E a linha fica, com o motivo: apagar esconderia a decisão.
      const { rows: alvo } = await c.query(
        `select status, motivo from public.message_campaign_targets
          where campaign_id = $1`,
        [campanha],
      );
      expect(alvo[0].status).toBe('skipped');
      expect(alvo[0].motivo).toMatch(/saiu da lista/);
    });
  });

  it('a fila pula quem saiu e entrega a quem ficou', async () => {
    // Se cinquenta saíram, a rodada não pode voltar vazia — tem que andar até
    // achar alguém. Este teste é o que prova que o laço existe.
    await comoPostgres(async (c) => {
      const saem = [
        await clienteAceito(c, 'Um'),
        await clienteAceito(c, 'Dois'),
        await clienteAceito(c, 'Tres'),
      ];
      const fica = await clienteAceito(c, 'Quatro');
      await conectaWhats(c);
      const campanha = await novaCampanha(c);
      expect(await montaEDispara(c, campanha)).toBe(4);

      // Força os três primeiros para o começo da fila, e o que fica para o fim:
      // sem isso o sorteio poderia entregar o certo por sorte, e o teste
      // passaria sem exercitar o laço.
      await c.query(
        `update public.message_campaign_targets set send_order = 1
          where campaign_id = $1 and customer_id = any($2)`,
        [campanha, saem],
      );
      await c.query(
        `update public.message_campaign_targets set send_order = 99
          where campaign_id = $1 and customer_id = $2`,
        [campanha, fica],
      );

      for (const id of saem) {
        await c.query(
          `update public.customers set marketing_opt_out_at = now() where id = $1`,
          [id],
        );
      }

      const { rows } = await c.query(`select * from public.reservar_proximo_envio()`);
      expect(rows).toHaveLength(1);

      const { rows: quem } = await c.query(
        `select customer_id from public.message_campaign_targets where id = $1`,
        [rows[0].alvo],
      );
      expect(quem[0].customer_id).toBe(fica);

      const { rows: pulados } = await c.query(
        `select count(*)::int as n from public.message_campaign_targets
          where campaign_id = $1 and status = 'skipped'`,
        [campanha],
      );
      expect(pulados[0].n).toBe(3);
    });
  });
});

describe('o link de saída', () => {
  it('está na mensagem mesmo sem o autor pedir', async () => {
    await comoPostgres(async (c) => {
      const cliente = await clienteAceito(c);
      const campanha = await novaCampanha(c, 'Texto sem link nenhum aqui dentro.');
      await viraStaff(c, DONO);
      await c.query(`select public.montar_publico($1)`, [campanha]);
      await c.query('reset role');

      const { rows } = await c.query(
        `select message from public.message_campaign_targets where campaign_id = $1`,
        [campanha],
      );
      const { rows: t } = await c.query(
        `select unsubscribe_token as tok from public.customers where id = $1`,
        [cliente],
      );

      expect(rows[0].message).toMatch(/Para não receber mais/);
      expect(rows[0].message).toContain(`/sair/${t[0].tok}`);
    });
  });

  it('o token do link existe de verdade na linha do cliente', async () => {
    // O buraco fácil: a mensagem inventa um token para o texto e não grava no
    // cliente. O link chegaria bonito no WhatsApp e não abriria nada.
    await comoPostgres(async (c) => {
      const cliente = await clienteAceito(c);
      // Simula quem foi aceito por um caminho que não criou token.
      await c.query(
        `update public.customers set unsubscribe_token = null where id = $1`,
        [cliente],
      );

      const campanha = await novaCampanha(c);
      await viraStaff(c, DONO);
      await c.query(`select public.montar_publico($1)`, [campanha]);
      await c.query('reset role');

      const { rows } = await c.query(
        `select message from public.message_campaign_targets where campaign_id = $1`,
        [campanha],
      );
      const tokenNoTexto = /\/sair\/([A-Za-z0-9_-]+)/.exec(rows[0].message)?.[1];
      expect(tokenNoTexto).toBeTruthy();

      const { rows: dono } = await c.query(`select * from public.dono_do_token($1)`, [
        tokenNoTexto,
      ]);
      expect(dono).toHaveLength(1);
    });
  });

  it('{nome} e {saldo} são trocados', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c, 'Maria Aparecida de Souza');
      const campanha = await novaCampanha(c, 'Oi {nome}, você tem {saldo} com a gente.');
      await viraStaff(c, DONO);
      await c.query(`select public.montar_publico($1)`, [campanha]);
      await c.query('reset role');

      const { rows } = await c.query(
        `select message from public.message_campaign_targets where campaign_id = $1`,
        [campanha],
      );
      // Primeiro nome, e não o nome inteiro: "Oi Maria Aparecida de Souza" é
      // como empresa escreve, não como gente escreve.
      expect(rows[0].message).toContain('Oi Maria,');
      expect(rows[0].message).toContain('R$ 0,00');
      expect(rows[0].message).not.toContain('{');
    });
  });
});

describe('o texto é congelado', () => {
  it('editar a campanha não reescreve o que já foi montado', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c);
      const campanha = await novaCampanha(c, 'Promoção de terça, venha!');
      await viraStaff(c, DONO);
      await c.query(`select public.montar_publico($1)`, [campanha]);

      await c.query(
        `update public.message_campaigns set corpo = 'Texto completamente outro.'
          where id = $1`,
        [campanha],
      );
      await c.query('reset role');

      const { rows } = await c.query(
        `select message from public.message_campaign_targets where campaign_id = $1`,
        [campanha],
      );
      expect(rows[0].message).toContain('Promoção de terça');
      expect(rows[0].message).not.toContain('completamente outro');
    });
  });
});

describe('duas rodadas não mandam duas vezes', () => {
  it('a segunda reserva volta vazia', async () => {
    // A vaga é reservada ANTES de enviar. Sem isso, um worker reiniciado no
    // meio pegaria o mesmo destinatário e a pessoa receberia duas mensagens.
    await comoPostgres(async (c) => {
      await clienteAceito(c, 'Um');
      await clienteAceito(c, 'Dois');
      await conectaWhats(c);
      const campanha = await novaCampanha(c);
      await montaEDispara(c, campanha);

      const { rows: a } = await c.query(`select * from public.reservar_proximo_envio()`);
      expect(a).toHaveLength(1);

      // Segunda chamada imediata: o relógio da campanha já foi empurrado.
      const { rows: b } = await c.query(`select * from public.reservar_proximo_envio()`);
      expect(b).toHaveLength(0);
    });
  });

  it('o intervalo entre mensagens fica entre 40 e 90 segundos', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c);
      await conectaWhats(c);
      const campanha = await novaCampanha(c);
      await montaEDispara(c, campanha);

      await c.query(`select * from public.reservar_proximo_envio()`);
      const { rows } = await c.query(
        `select extract(epoch from (next_send_at - now())) as s
           from public.message_campaigns where id = $1`,
        [campanha],
      );
      expect(Number(rows[0].s)).toBeGreaterThanOrEqual(39);
      expect(Number(rows[0].s)).toBeLessThanOrEqual(91);
    });
  });
});

describe('o telefone não sai por esta porta', () => {
  it('a equipe não executa a reserva', async () => {
    await comoPostgres(async (c) => {
      await viraStaff(c, DONO);
      await esperaFalhar(
        c,
        `select * from public.reservar_proximo_envio()`,
        [],
        /permission denied|permissão negada/i,
      );
    });
  });

  it('a view de progresso não tem telefone nem texto de destinatário', async () => {
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'campanhas_com_progresso'`,
      );
      const colunas = rows.map((r) => r.column_name);
      expect(colunas).not.toContain('phone');
      expect(colunas).not.toContain('telefone');
      expect(colunas).toContain('enviados');
    });
  });

  it('a fila guarda customer_id, e não o número', async () => {
    await comoPostgres(async (c) => {
      const { rows } = await c.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'message_campaign_targets'`,
      );
      const colunas = rows.map((r) => r.column_name);
      expect(colunas).toContain('customer_id');
      expect(colunas).not.toContain('phone');
    });
  });
});

describe('o teto do dia', () => {
  it('segura o envio sem marcar ninguém como falho', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c, 'Um');
      await clienteAceito(c, 'Dois');
      await conectaWhats(c);
      await c.query(
        `update public.restaurants set marketing_max_por_dia = 1 where id = $1`,
        [RESTAURANTE],
      );

      const campanha = await novaCampanha(c);
      await montaEDispara(c, campanha);

      // Primeira sai.
      const { rows: a } = await c.query(`select * from public.reservar_proximo_envio()`);
      expect(a).toHaveLength(1);
      await c.query(`select public.concluir_envio($1, true)`, [a[0].alvo]);

      // Segunda esbarra no teto. Destrava o relógio para provar que o que
      // segura é o teto, e não o intervalo de 40 s.
      await c.query(
        `update public.message_campaigns set next_send_at = now() - interval '1 minute'
          where id = $1`,
        [campanha],
      );
      const { rows: b } = await c.query(`select * from public.reservar_proximo_envio()`);
      expect(b).toHaveLength(0);

      // E ninguém foi marcado como falho: o limite é nosso, não deles.
      const { rows: est } = await c.query(
        `select status, count(*)::int as n from public.message_campaign_targets
          where campaign_id = $1 group by status order by status`,
        [campanha],
      );
      expect(est).toEqual([
        { status: 'pending', n: 1 },
        { status: 'sent', n: 1 },
      ]);

      const { rows: camp } = await c.query(
        `select status, last_error from public.message_campaigns where id = $1`,
        [campanha],
      );
      expect(camp[0].status).toBe('sending');
      expect(camp[0].last_error).toMatch(/Teto/);
    });
  });
});

describe('as portas fechadas', () => {
  it('sem WhatsApp conectado não dispara', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c);
      await c.query(
        `update public.restaurants set evolution_instance_name = null where id = $1`,
        [RESTAURANTE],
      );
      const campanha = await novaCampanha(c);

      await viraStaff(c, DONO);
      await c.query(`select public.montar_publico($1)`, [campanha]);
      await esperaFalhar(
        c,
        `select public.iniciar_campanha($1)`,
        [campanha],
        /Conecte o WhatsApp/,
      );
    });
  });

  it('campanha sem ninguém não dispara', async () => {
    await comoPostgres(async (c) => {
      await conectaWhats(c);
      const campanha = await novaCampanha(c);
      await viraStaff(c, DONO);
      await esperaFalhar(
        c,
        `select public.iniciar_campanha($1)`,
        [campanha],
        /Não há ninguém/,
      );
    });
  });

  it('garçom não escreve campanha', async () => {
    await comoPostgres(async (c) => {
      await viraStaff(c, GARCOM);
      await esperaFalhar(
        c,
        `insert into public.message_campaigns (restaurant_id, titulo, corpo)
         values ($1, 'Do garçom', 'texto qualquer aqui')`,
        [RESTAURANTE],
        /row-level security|violates/i,
      );
    });
  });

  it('garçom não monta público nem dispara', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c);
      await conectaWhats(c);
      const campanha = await novaCampanha(c);

      await viraStaff(c, GARCOM);
      await esperaFalhar(
        c,
        `select public.montar_publico($1)`,
        [campanha],
        /dono ou gerente|não encontrada/,
      );
    });
  });

  it('ninguém insere destinatário à mão — nem o dono', async () => {
    // A fila é o último lugar antes do envio: o que entra aqui SAI. Um INSERT
    // livre acrescentaria um telefone que nunca autorizou nada.
    await comoPostgres(async (c) => {
      const cliente = await clienteAceito(c);
      const campanha = await novaCampanha(c);

      await viraStaff(c, DONO);
      await esperaFalhar(
        c,
        `insert into public.message_campaign_targets
           (restaurant_id, campaign_id, customer_id, message)
         values ($1, $2, $3, 'mensagem à mão')`,
        [RESTAURANTE, campanha, cliente],
        /permission denied|row-level security/i,
      );
    });
  });

  it('a mesma pessoa não entra duas vezes na mesma campanha', async () => {
    await comoPostgres(async (c) => {
      const cliente = await clienteAceito(c);
      const campanha = await novaCampanha(c);
      await viraStaff(c, DONO);
      await c.query(`select public.montar_publico($1)`, [campanha]);
      await c.query('reset role');

      await esperaFalhar(
        c,
        `insert into public.message_campaign_targets
           (restaurant_id, campaign_id, customer_id, message)
         values ($1, $2, $3, 'de novo')`,
        [RESTAURANTE, campanha, cliente],
        /uma_vez|duplicate key/i,
      );
    });
  });

  it('remontar o público de uma campanha já iniciada é recusado', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c);
      await conectaWhats(c);
      const campanha = await novaCampanha(c);
      await montaEDispara(c, campanha);

      await viraStaff(c, DONO);
      await esperaFalhar(
        c,
        `select public.montar_publico($1)`,
        [campanha],
        /só é montado antes/,
      );
    });
  });

  it('quem nunca aceitou não entra no público', async () => {
    await comoPostgres(async (c) => {
      await c.query(
        `insert into public.customers (restaurant_id, cpf, name, phone, password_hash)
         values ($1, $2, 'Nunca Aceitou', '11955554444', 'x')`,
        [RESTAURANTE, cpf()],
      );
      const campanha = await novaCampanha(c);
      await viraStaff(c, DONO);
      const { rows } = await c.query(`select public.montar_publico($1) as n`, [campanha]);
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('o fim da fila', () => {
  it('a campanha fecha sozinha quando o último sai', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c);
      await conectaWhats(c);
      const campanha = await novaCampanha(c);
      await montaEDispara(c, campanha);

      const { rows } = await c.query(`select * from public.reservar_proximo_envio()`);
      await c.query(`select public.concluir_envio($1, true)`, [rows[0].alvo]);

      const { rows: camp } = await c.query(
        `select status, finished_at is not null as fechou
           from public.message_campaigns where id = $1`,
        [campanha],
      );
      expect(camp[0].status).toBe('done');
      expect(camp[0].fechou).toBe(true);
    });
  });

  it('uma falha não fecha a campanha nem some com o destinatário', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c, 'Um');
      await clienteAceito(c, 'Dois');
      await conectaWhats(c);
      const campanha = await novaCampanha(c);
      await montaEDispara(c, campanha);

      const { rows } = await c.query(`select * from public.reservar_proximo_envio()`);
      await c.query(`select public.concluir_envio($1, false, 'Evolution fora do ar')`, [
        rows[0].alvo,
      ]);

      const { rows: alvo } = await c.query(
        `select status, error_message from public.message_campaign_targets where id = $1`,
        [rows[0].alvo],
      );
      expect(alvo[0].status).toBe('failed');
      expect(alvo[0].error_message).toBe('Evolution fora do ar');

      const { rows: camp } = await c.query(
        `select status from public.message_campaigns where id = $1`,
        [campanha],
      );
      expect(camp[0].status).toBe('sending');
    });
  });

  it('concluir um envio que não foi reservado não faz nada', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c);
      const campanha = await novaCampanha(c);
      await viraStaff(c, DONO);
      await c.query(`select public.montar_publico($1)`, [campanha]);
      await c.query('reset role');

      const { rows: alvo } = await c.query(
        `select id from public.message_campaign_targets where campaign_id = $1`,
        [campanha],
      );
      // Ainda `pending`, nunca reservado. Marcar como enviado aqui seria
      // registrar um envio que não aconteceu.
      const { rows } = await c.query(`select public.concluir_envio($1, true) as ok`, [
        alvo[0].id,
      ]);
      expect(rows[0].ok).toBe(false);
    });
  });
});

describe('agendamento', () => {
  it('a hora marcada entra na fila sozinha', async () => {
    await comoPostgres(async (c) => {
      await clienteAceito(c);
      await conectaWhats(c);
      const campanha = await novaCampanha(c);

      await viraStaff(c, DONO);
      await c.query(`select public.montar_publico($1)`, [campanha]);
      await c.query(`select public.iniciar_campanha($1, now() + interval '1 hour')`, [
        campanha,
      ]);
      await c.query('reset role');

      // Ainda não é hora: continua parada.
      expect((await c.query(`select public.promover_agendadas() as n`)).rows[0].n).toBe(0);

      // A hora chega.
      await c.query(
        `update public.message_campaigns set scheduled_at = now() - interval '1 minute'
          where id = $1`,
        [campanha],
      );
      expect(
        (await c.query(`select public.promover_agendadas() as n`)).rows[0].n,
      ).toBeGreaterThanOrEqual(1);

      const { rows } = await c.query(
        `select status from public.message_campaigns where id = $1`,
        [campanha],
      );
      expect(rows[0].status).toBe('sending');
    });
  });
});
