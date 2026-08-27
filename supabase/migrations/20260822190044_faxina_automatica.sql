-- =============================================================================
-- 0044 — A faxina descobre as tabelas sozinha
-- =============================================================================
-- O QUE ACONTECEU
--
-- `app.limpar_demos_vencidas` tinha vinte e um DELETEs escritos à mão, das
-- folhas para a raiz. A 0043 criou `product_badges`, que referencia
-- `restaurants` com `on delete restrict` — e a faxina passou a falhar, porque
-- ninguém acrescentou a linha nova àquela lista.
--
-- Eu tinha ESCRITO esse cenário no cabeçalho da 0042, palavra por palavra:
-- "uma tabela nova que alguém acrescentar sem incluir na ordem de exclusão".
-- E o cometi uma migration depois. Lista escrita à mão que precisa acompanhar o
-- esquema não é solução — é uma dívida com data marcada.
--
-- Graças à 0042 isso não derrubou a geração de demonstração: a exceção virou
-- `warning` e a demo nasceu assim mesmo. O efeito visível era só as demos
-- vencidas nunca sumirem — o banco enchendo devagar, sem ninguém notar.
--
-- COMO PASSA A FUNCIONAR
--
-- A função descobre em `information_schema` toda tabela de `public` que tem
-- coluna `restaurant_id`, e tenta apagar de todas. As que falharem por chave
-- estrangeira ficam para a rodada seguinte, quando as filhas já saíram. Repete
-- até ninguém mais falhar.
--
-- É mais lento que a ordem escrita à mão, e roda no máximo algumas vezes por
-- hora, quando alguém gera uma demonstração. Correto e automático vale mais que
-- rápido e desatualizado.
--
-- O QUE ELA NÃO TOCA
--
-- `auth.users`. A conta de login sobrevive à demonstração desde a 0036, e este
-- laço varre só `public` — a decisão continua valendo por construção, não por
-- lembrança.
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
begin
  -- As RESPOSTAS do briefing vencem em 3 horas mesmo em restaurante de
  -- verdade: já viraram categoria, produto e mesa, e guardar cidade e porte da
  -- casa depois disso é acumular dado de alguém sem uso.
  delete from public.restaurant_briefing where expires_at < now();

  select array_agg(id) into v_ids
    from public.restaurants
   where expires_at is not null and expires_at < now();

  if v_ids is null then return 0; end if;
  v_qtd := array_length(v_ids, 1);

  -- Dez rodadas é folga larga: a cadeia mais profunda hoje tem quatro níveis
  -- (order_item_modifiers → order_items → orders → table_sessions). O teto
  -- existe para um ciclo de chaves estrangeiras não virar laço infinito.
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
         -- A raiz sai por último, fora do laço.
         and c.table_name <> 'restaurants'
       order by c.table_name
    loop
      begin
        execute format(
          'delete from public.%I where restaurant_id = any($1)', v_tabela
        ) using v_ids;
      exception
        when foreign_key_violation then
          -- Ainda tem filha viva. Próxima rodada.
          v_faltou := true;
      end;
    end loop;

    exit when not v_faltou or v_rodada >= 10;
  end loop;

  -- O PERFIL sai no laço acima (tem `restaurant_id`). A CONTA DE LOGIN fica —
  -- ver 0036. Este laço varre só `public`, então `auth.users` está fora do
  -- alcance por construção.
  delete from public.restaurants where id = any(v_ids);

  return v_qtd;
end;
$$;

revoke all on function app.limpar_demos_vencidas() from public, anon, authenticated;
grant execute on function app.limpar_demos_vencidas() to service_role;

comment on function app.limpar_demos_vencidas() is
  'Apaga demonstrações vencidas. Descobre as tabelas por information_schema, '
  'então tabela nova entra sozinha. A conta de login sobrevive.';

-- -----------------------------------------------------------------------------
-- Selo do sistema não se apaga — EXCETO quando a casa inteira está indo embora.
--
-- O trigger da 0043 existe para impedir uma PESSOA de apagar `novo` ou
-- `picante` pela tela e deixar produtos com selo órfão. Ele não tem nada a ver
-- com remover um restaurante de demonstração vencido, e estava barrando
-- exatamente isso — a faxina falhava com "Este selo é do sistema".
--
-- A condição é a mesma da fresta do `audit_log` na 0034, e pelo mesmo motivo:
-- só demonstração, só depois de vencida, e `expires_at` só é preenchido por
-- `gerar_demonstracao`. Casa de verdade tem a coluna nula e nunca satisfaz.
-- -----------------------------------------------------------------------------
create or replace function app.selo_interno_nao_apaga()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.restaurants r
     where r.id = old.restaurant_id
       and r.expires_at is not null
       and r.expires_at < now()
  ) then
    return old;
  end if;

  if old.built_in then
    raise exception 'Este selo é do sistema: desative em vez de apagar'
      using errcode = '45121';
  end if;

  if exists (
    select 1 from public.products p
     where p.restaurant_id = old.restaurant_id and old.slug = any(p.badges)
  ) then
    raise exception 'Há produtos usando este selo. Tire-os antes de apagar'
      using errcode = '45122';
  end if;

  return old;
end;
$$;
