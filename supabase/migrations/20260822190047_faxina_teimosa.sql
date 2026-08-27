-- =============================================================================
-- 0047 — A faxina não desiste na primeira pedra
-- =============================================================================
-- O QUE QUEBROU
--
-- A 0044 descobre as tabelas por `information_schema` e tenta apagar de todas,
-- repetindo até ninguém mais falhar. O laço captura `foreign_key_violation` —
-- e só isso.
--
-- Em produção apareceu outro erro, que o banco local nunca produziu:
--
--   null value in column "restaurant_id" of relation "table_sessions"
--   violates not-null constraint
--   CONTEXT: UPDATE ... SET "released_by" = NULL, "restaurant_id" = NULL
--            SQL statement "delete from public.profiles ..."
--
-- `table_sessions` tem uma chave estrangeira COMPOSTA para `profiles`
-- — `(released_by, restaurant_id)` — com `on delete set null`. Ao apagar o
-- perfil, o Postgres anula AS DUAS colunas da chave, e `restaurant_id` é
-- `not null`. O erro é `not_null_violation`, não violação de FK, então o laço
-- não o capturava e a função inteira abortava.
--
-- A ordem alfabética punha `profiles` antes de `table_sessions`. Com as sessões
-- já apagadas não haveria o que anular — mas depender da ordem alfabética para
-- isso é o mesmo tipo de sorte que a 0044 existiu para eliminar.
--
-- O CONSERTO
--
-- Capturar QUALQUER erro por tabela, e não só um tipo. A tabela que falhar fica
-- para a rodada seguinte, quando as suas dependentes já saíram. É o mesmo
-- desenho de antes — o defeito era a lista de erros ser curta demais, exatamente
-- como a lista de tabelas era curta demais.
--
-- E se ao fim das rodadas ainda restar algo, a função AVISA em vez de devolver
-- um número que sugere sucesso. Faxina que falha em silêncio é como não ter
-- faxina, com a desvantagem de parecer que tem.
-- =============================================================================

create or replace function app.limpar_demos_vencidas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
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
        -- QUALQUER erro, não só violação de FK.
        --
        -- Chave estrangeira composta com `on delete set null` produz
        -- `not_null_violation`; trigger de proteção produz outra coisa. O que
        -- todos têm em comum é serem temporários: somem quando as dependentes
        -- saem. Insistir é mais barato que enumerar os erros possíveis, e não
        -- envelhece.
        when others then
          v_faltou := true;
          v_ultimo := v_tabela || ' (' || sqlstate || ': ' || sqlerrm || ')';
      end;
    end loop;

    exit when not v_faltou or v_rodada >= 10;
  end loop;

  if v_faltou then
    -- Não silencia. Devolver um número que parece sucesso enquanto o banco
    -- continua cheio é o pior dos dois mundos.
    raise warning 'faxina incompleta depois de % rodadas; último obstáculo: %',
      v_rodada, v_ultimo;
  end if;

  delete from public.restaurants where id = any(v_ids);

  return v_qtd;
end;
$$;

revoke all on function app.limpar_demos_vencidas() from public, anon, authenticated;
grant execute on function app.limpar_demos_vencidas() to service_role;
