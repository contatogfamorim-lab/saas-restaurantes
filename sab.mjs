import pg from 'pg';
import { readFileSync } from 'node:fs';
const c = new pg.Client('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
await c.connect();
const real = readFileSync('supabase/migrations/20260822190061_demo_leva_o_login_junto.sql','utf8');
const alvo = `  if v_contas is not null then
    delete from auth.users u
     where u.id = any(v_contas)
       and not exists (select 1 from public.profiles p where p.id = u.id);
  end if;`;
if (!real.includes(alvo)) { console.log('ÂNCORA NÃO ENCONTRADA'); process.exit(1); }
await c.query(real.replace(alvo, '  -- sabotado: a conta fica'));
const { rows } = await c.query(`select prosrc from pg_proc where proname='limpar_demos_vencidas'`);
console.log('sabotagem aplicada?', rows[0].prosrc.includes('sabotado: a conta fica') ? 'SIM':'NÃO');
await c.end();
