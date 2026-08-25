-- =============================================================================
-- 0033 — Endurecimento: freio de tentativa de login (spec §10.6)
-- =============================================================================
-- O QUE ESTAVA ABERTO
--
-- A 0024 registrou que "o rate limiting de login passa a ser o do GoTrue".
-- Isso vale quando o navegador fala com o GoTrue direto. Aqui não é o caso: o
-- login é uma Server Action, e quem chama `signInWithPassword` é o SERVIDOR.
--
-- Medido: `auth.audit_log_entries` não registra `ip_address` em nenhuma das
-- tentativas feitas por este app, e `@supabase/auth-js` não repassa
-- `X-Forwarded-For`. Ou seja, o `sign_in_sign_ups = 30` por IP do GoTrue vira
-- UM BALDE SÓ para a aplicação inteira. Duas consequências, e as duas ruins:
--
--   força bruta contra uma conta específica não encontra freio nenhum, porque
--   todas as tentativas do mundo compartilham o mesmo IP de origem;
--
--   e quem quiser derrubar o login de todos os restaurantes só precisa gastar
--   o balde — negação de serviço a custo de trinta requisições.
--
-- O freio precisa então morar aqui. Em Postgres, e não em memória do processo:
-- contador em memória não sobrevive a duas instâncias, que é o cenário de
-- produção.
--
-- NADA DE DADO PESSOAL AQUI DENTRO
--
-- A tabela guarda HASH do identificador e do IP, nunca os valores. Um freio de
-- login que armazena e-mail e endereço vira, sem querer, o registro de quem
-- tentou entrar de onde — e a §10.10 é explícita: nunca registre dado pessoal.
-- Para contar tentativas, o hash serve igual.
--
-- SÓ O SERVIDOR CHAMA
--
-- As funções estão em `public` porque o PostgREST não expõe o schema `app` —
-- mas o EXECUTE é exclusivo de `service_role`. Se `anon` pudesse chamá-las,
-- qualquer pessoa esvaziaria o balde de uma conta alheia com nove requisições
-- e a trancaria fora do sistema. Um freio que qualquer um aciona contra
-- qualquer um é uma arma, não uma proteção.
-- =============================================================================

create table public.auth_throttle (
  chave        text        not null,
  -- Início da janela. Duas linhas por chave nunca coexistem para a mesma
  -- janela, e a limpeza é por data.
  janela       timestamptz not null,
  tentativas   int         not null default 1 check (tentativas >= 0),
  primary key (chave, janela)
);

create index auth_throttle_limpeza_idx on public.auth_throttle (janela);

comment on table public.auth_throttle is
  'Contador de FALHAS de login. Guarda hash de identificador e IP, nunca os '
  'valores — freio que registra quem tentou de onde é um log de dado pessoal '
  '(spec §10.10).';

alter table public.auth_throttle enable row level security;

-- Ninguém lê, ninguém escreve — nem `anon`, nem `authenticated`. A policy
-- existe explícita, em vez de simplesmente não haver policy, para dizer que a
-- ausência é decisão e não esquecimento.
create policy auth_throttle_ninguem on public.auth_throttle
  for select to anon, authenticated using (false);

/**
 * Esta tentativa pode prosseguir?
 *
 * Só LÊ. Quem conta é `registrar_falha_de_login`, e só quando a senha erra —
 * a primeira versão desta migration incrementava antes de saber o resultado, o
 * que somava as entradas bem-sucedidas ao balde e trancava quem estava
 * simplesmente trabalhando.
 *
 * Dois baldes, e os dois precisam estar abaixo do teto:
 *
 *   por CONTA — segura força bruta contra uma pessoa específica. É o ataque que
 *   mais dá certo em restaurante, porque `operator_code` é curto e está colado
 *   no crachá;
 *
 *   por ORIGEM — segura varredura de muitas contas do mesmo lugar.
 *
 * Os tetos são diferentes de propósito: uma pessoa erra a própria senha três,
 * quatro vezes num dia ruim; quarenta erros do mesmo lugar em dez minutos não
 * é dia ruim.
 *
 * LIMITE CONHECIDO: quem souber o identificador de alguém consegue trancá-lo
 * por dez minutos errando a senha oito vezes. É o preço de qualquer freio por
 * conta, e o outro lado — não ter freio — é pior: sem ele a senha é testada à
 * vontade. Mitigar isso de verdade pede captcha ou segundo fator, que estão
 * fora do escopo declarado.
 */
create or replace function public.login_permitido(
  p_hash_conta  text,
  p_hash_origem text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select sum(tentativas) filter (where chave = 'c:' || p_hash_conta) < 8
        and coalesce(sum(tentativas) filter (where chave = 'o:' || p_hash_origem), 0) < 40
       from public.auth_throttle
      where janela > now() - interval '10 minutes'
        and chave in ('c:' || p_hash_conta, 'o:' || p_hash_origem)),
    true
  );
$$;

/**
 * Conta uma falha.
 *
 * A janela é FIXA e não deslizante. Deslizante seria mais justo e exigiria
 * guardar cada tentativa individualmente — de novo, um registro de quem tentou
 * quando. Janela fixa conta e esquece.
 */
create or replace function public.registrar_falha_de_login(
  p_hash_conta  text,
  p_hash_origem text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_janela constant interval := interval '10 minutes';
  v_inicio timestamptz := date_bin(v_janela, now(), timestamptz 'epoch');
begin
  -- Limpeza oportunista: sem cron, a tabela cresceria para sempre. Uma janela
  -- de folga para não apagar o que ainda está em uso.
  delete from public.auth_throttle where janela < now() - (v_janela * 3);

  insert into public.auth_throttle (chave, janela)
  values ('c:' || p_hash_conta, v_inicio), ('o:' || p_hash_origem, v_inicio)
  on conflict (chave, janela)
    do update set tentativas = public.auth_throttle.tentativas + 1;
end;
$$;

/**
 * Zera o balde da conta depois de um login que deu certo.
 *
 * O balde de ORIGEM não zera: ele existe para medir varredura, e uma varredura
 * que acerta uma conta não deixa de ser varredura.
 */
create or replace function public.liberar_freio_de_login(p_hash_conta text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.auth_throttle where chave = 'c:' || p_hash_conta;
$$;

-- O EXECUTE é só do servidor. `anon` e `authenticated` não chamam nenhuma das
-- três — ver o cabeçalho deste arquivo.
revoke all on function public.login_permitido(text, text) from public, anon, authenticated;
revoke all on function public.registrar_falha_de_login(text, text) from public, anon, authenticated;
revoke all on function public.liberar_freio_de_login(text) from public, anon, authenticated;

grant execute on function public.login_permitido(text, text) to service_role;
grant execute on function public.registrar_falha_de_login(text, text) to service_role;
grant execute on function public.liberar_freio_de_login(text) to service_role;
