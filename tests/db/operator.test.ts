/**
 * Acesso por código de operador + senha de 5 dígitos (spec §10.5).
 *
 * 5 dígitos são 100.000 combinações — não é senha forte, e o que a torna
 * aceitável é o conjunto: aparelho liberado, bloqueio na quinta tentativa e
 * auditoria. Estes testes cobrem as duas últimas; a primeira é a camada de
 * aplicação e não passa pelo banco.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { verify } from '@node-rs/argon2';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTAURANTE_A = '11111111-1111-4111-8111-111111111111';

/** Espelha o seed. Se mudar lá, este teste tem que quebrar. */
const OPERADORES = [
  { codigo: '01', senha: '47628', nome: 'Ivo Bezerra' },
  { codigo: '02', senha: '91387', nome: 'Ravi Nunes' },
  { codigo: '03', senha: '29574', nome: 'Selma Prado' },
  { codigo: '04', senha: '64839', nome: 'Nara Vilaça' },
];

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  await pool.query(
    `update profiles set pin_failed_attempts = 0, pin_locked_until = null
      where restaurant_id = $1`,
    [RESTAURANTE_A],
  );
});

afterAll(async () => {
  await pool?.end();
});

describe('credenciais do operador', () => {
  it.each(OPERADORES)('$nome entra com $codigo e a senha certa', async (op) => {
    const { rows } = await pool.query(
      `select pin_hash, name from profiles
        where restaurant_id = $1 and operator_code = $2`,
      [RESTAURANTE_A, op.codigo],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(op.nome);
    await expect(verify(rows[0].pin_hash, op.senha)).resolves.toBe(true);
  });

  it('senha errada não passa', async () => {
    const { rows } = await pool.query(
      `select pin_hash from profiles where restaurant_id = $1 and operator_code = '01'`,
      [RESTAURANTE_A],
    );
    await expect(verify(rows[0].pin_hash, '00000')).resolves.toBe(false);
  });

  it('a senha é argon2id, não hash simples', async () => {
    const { rows } = await pool.query(
      `select pin_hash from profiles where operator_code is not null`,
    );
    for (const r of rows) {
      expect(r.pin_hash).toMatch(/^\$argon2id\$/);
    }
  });

  it('quem administra NÃO tem código de operador — a porta dele é outra', async () => {
    const { rows } = await pool.query(
      `select name, operator_code, pin_hash from profiles
        where restaurant_id = $1 and roles @> array['owner']::staff_role[]`,
      [RESTAURANTE_A],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].operator_code).toBeNull();
    expect(rows[0].pin_hash).toBeNull();
  });

  it('o código é único dentro do restaurante', async () => {
    const { rows: [ivo] } = await pool.query(
      `select id from profiles where restaurant_id = $1 and operator_code = '02'`,
      [RESTAURANTE_A],
    );
    await expect(
      pool.query(`update profiles set operator_code = '01' where id = $1`, [ivo.id]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('§10.5 — bloqueio por tentativa errada', () => {
  it('a quinta tentativa errada bloqueia por 15 minutos', async () => {
    const { rows: [perfil] } = await pool.query(
      `select id from profiles where restaurant_id = $1 and operator_code = '03'`,
      [RESTAURANTE_A],
    );

    try {
      for (let i = 1; i <= 4; i++) {
        const { rows } = await pool.query(
          `select public.register_pin_failure($1) as r`, [perfil.id]);
        expect(rows[0].r.bloqueado, `tentativa ${i} não deveria bloquear`).toBe(false);
        expect(rows[0].r.tentativas).toBe(i);
      }

      const { rows } = await pool.query(
        `select public.register_pin_failure($1) as r`, [perfil.id]);
      expect(rows[0].r.bloqueado).toBe(true);
      expect(rows[0].r.tentativas).toBe(5);

      const minutos =
        (new Date(rows[0].r.bloqueado_ate).getTime() - Date.now()) / 60_000;
      expect(minutos).toBeGreaterThan(14);
      expect(minutos).toBeLessThanOrEqual(15);
    } finally {
      await pool.query(
        `update profiles set pin_failed_attempts = 0, pin_locked_until = null where id = $1`,
        [perfil.id],
      );
    }
  });

  it('toda tentativa falha vai para o audit_log', async () => {
    const { rows: [perfil] } = await pool.query(
      `select id from profiles where restaurant_id = $1 and operator_code = '04'`,
      [RESTAURANTE_A],
    );

    try {
      const antes = await pool.query(
        `select count(*)::int as n from audit_log
          where action = 'operator.pin_failed' and entity_id = $1`, [perfil.id]);

      await pool.query(`select public.register_pin_failure($1)`, [perfil.id]);

      const depois = await pool.query(
        `select count(*)::int as n from audit_log
          where action = 'operator.pin_failed' and entity_id = $1`, [perfil.id]);

      expect(depois.rows[0].n).toBe(antes.rows[0].n + 1);
    } finally {
      await pool.query(
        `update profiles set pin_failed_attempts = 0, pin_locked_until = null where id = $1`,
        [perfil.id],
      );
    }
  });

  it('entrar com sucesso zera o contador e registra a entrada', async () => {
    const { rows: [perfil] } = await pool.query(
      `select id from profiles where restaurant_id = $1 and operator_code = '01'`,
      [RESTAURANTE_A],
    );

    await pool.query(`select public.register_pin_failure($1)`, [perfil.id]);
    await pool.query(`select public.register_pin_failure($1)`, [perfil.id]);

    await pool.query(`select public.register_pin_success($1)`, [perfil.id]);

    const { rows } = await pool.query(
      `select pin_failed_attempts, pin_locked_until from profiles where id = $1`,
      [perfil.id]);
    expect(rows[0].pin_failed_attempts).toBe(0);
    expect(rows[0].pin_locked_until).toBeNull();

    const { rows: log } = await pool.query(
      `select count(*)::int as n from audit_log
        where action = 'operator.signed_in' and entity_id = $1`, [perfil.id]);
    expect(log[0].n).toBeGreaterThan(0);
  });
});

describe('§10.5 — aparelho confiável', () => {
  it('só quem administra enxerga a lista de aparelhos', async () => {
    const { rows: [garcom] } = await pool.query(
      `select id from profiles where restaurant_id = $1 and operator_code = '01'`,
      [RESTAURANTE_A]);

    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(
        `insert into trusted_devices (restaurant_id, label, token_hash)
         values ($1, 'Tablet de teste', 'hash-de-teste')`, [RESTAURANTE_A]);

      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role','authenticated')::text, true)`,
        [garcom.id]);
      await c.query('set local role authenticated');

      const { rows } = await c.query(`select count(*)::int as n from trusted_devices`);
      // A lista de aparelhos liberados é mapa de onde o sistema está aberto:
      // garçom não precisa dela, e é por isso que não a vê.
      expect(rows[0].n).toBe(0);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('o banco guarda hash do token, nunca o token do aparelho', async () => {
    const { rows } = await pool.query(
      `select column_name from information_schema.columns
        where table_name = 'trusted_devices' and table_schema = 'public'`);
    const colunas = rows.map((r) => r.column_name);

    expect(colunas).toContain('token_hash');
    // Se um dia aparecer uma coluna com o token cru, este teste quebra —
    // e é para quebrar: base vazada não pode devolver o acesso de um tablet.
    expect(colunas).not.toContain('token');
    expect(colunas).not.toContain('secret');
  });
});
