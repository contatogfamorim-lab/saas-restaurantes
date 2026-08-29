-- =============================================================================
-- 0061 — A demonstração vencida leva a conta de login junto
-- =============================================================================
-- MUDANÇA DE DECISÃO, PEDIDA PELO DONO DO PRODUTO.
--
-- A 0036 tinha decidido o contrário: apagar o restaurante e PRESERVAR o login,
-- para poupar quem gostou do sistema de um segundo ida-e-volta na confirmação
-- de e-mail. A decisão agora é que a demonstração não deixa rastro nenhum —
-- passadas as três horas, não sobra conta.
--
-- Isso é reversível e provavelmente será revisto: o custo real continua sendo o
-- que a 0036 descreveu, e quem voltar para montar o restaurante de verdade vai
-- confirmar o e-mail de novo.
--
-- A RESSALVA, E POR QUE ELA É INÓCUA HOJE
--
-- A conta só é apagada se, depois da faxina, não tiver sobrado perfil em lugar
-- nenhum. Escrevi isso pensando em quem tem restaurante de verdade e cria uma
-- demonstração para mostrar a alguém — a 0034 apagava essa pessoa.
--
-- Tentando testar, descobri que o estado É INALCANÇÁVEL: `profiles.id` é CHAVE
-- PRIMÁRIA e referencia `auth.users`, então uma conta tem no máximo um perfil,
-- em um restaurante só. `create_restaurant` ainda reforça isso recusando com
-- "Esta conta já pertence a um restaurante", e a tela de Equipe é só leitura.
-- Ou seja: `not exists` é hoje sempre verdadeiro, e não protege nada.
--
-- Fica assim mesmo, e não é preguiça. Suportar uma pessoa em duas casas exige
-- trocar aquela chave primária por uma composta, e no dia em que isso
-- acontecer esta faxina passaria a apagar o acesso de gente que trabalha em
-- restaurante de verdade — de madrugada, em silêncio, sem ninguém ligar uma
-- coisa à outra. O custo de deixar escrito é uma subconsulta por conta.
--
-- NÃO HÁ TESTE para essa ressalva, porque não dá para montar o cenário sem
-- violar a chave primária. Registrado aqui em vez de simulado com um teste que
-- mentiria sobre estar cobrindo alguma coisa.
-- =============================================================================
create or replace function app.limpar_demos_vencidas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_contas  uuid[];
  v_qtd     int;
  v_tabela  text;
  v_faltou  boolean;
  v_rodada  int := 0;
  v_ultimo  text;
begin
  delete from public.restaurant_briefing where expires_at < now();

  select array_agg(id) into v_ids
    from public.restaurants
   where expires_at is not null and expires_at < now();

  if v_ids is null then return 0; end if;
  v_qtd := array_length(v_ids, 1);

  -- ANTES do laço, porque `profiles` tem `restaurant_id` e o laço a apaga junto
  -- com o resto. Depois não haveria mais de onde tirar quem eram estas pessoas.
  select array_agg(id) into v_contas
    from public.profiles where restaurant_id = any(v_ids);

  loop
    v_rodada := v_rodada + 1;
    v_faltou := false;

    for v_tabela in
      select c.table_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public'
         and c.column_name = 'restaurant_id'
         and t.table_type = 'BASE TABLE'
         and c.table_name <> 'restaurants'
       order by c.table_name
    loop
      begin
        execute format(
          'delete from public.%I where restaurant_id = any($1)', v_tabela
        ) using v_ids;
      exception
        -- Qualquer erro, não só violação de FK: ver o raciocínio na 0047.
        when others then
          v_faltou := true;
          v_ultimo := v_tabela || ' (' || sqlstate || ': ' || sqlerrm || ')';
      end;
    end loop;

    exit when not v_faltou or v_rodada >= 10;
  end loop;

  if v_faltou then
    raise warning 'faxina incompleta depois de % rodadas; último obstáculo: %',
      v_rodada, v_ultimo;
  end if;

  delete from public.restaurants where id = any(v_ids);

  /*
   * A CONTA DE LOGIN, POR ÚLTIMO E COM RESSALVA.
   *
   * Por último porque a condição depende de a faxina já ter acontecido: é o
   * `profiles` restante que responde "esta pessoa ainda trabalha em algum
   * lugar?". Rodar isto antes olharia para perfis que estão prestes a sumir e
   * pouparia justamente quem devia sair.
   *
   * `not exists` e não `left join`: a pergunta é sobre AUSÊNCIA em qualquer
   * restaurante, e um join traria de volta as linhas que acabaram de ser
   * apagadas se alguém mexesse na ordem.
   */
  if v_contas is not null then
    delete from auth.users u
     where u.id = any(v_contas)
       and not exists (select 1 from public.profiles p where p.id = u.id);
  end if;

  return v_qtd;
end;
$$;

revoke all on function app.limpar_demos_vencidas() from public, anon, authenticated;
grant execute on function app.limpar_demos_vencidas() to service_role;

comment on function app.limpar_demos_vencidas() is
  'Apaga as demonstrações vencidas por inteiro: restaurante, pedidos, mesas, '
  'perfil e a conta de login. A conta só sobrevive se a pessoa tiver perfil '
  'em outro restaurante — demonstração não deixa rastro, mas também não '
  'apaga quem tem casa de verdade.';
