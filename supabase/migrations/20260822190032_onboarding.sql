-- =============================================================================
-- 0032 — Onboarding: criar restaurante, primeiro administrador e mesas
-- =============================================================================
-- O OVO E A GALINHA
--
-- Ninguém consegue criar um restaurante hoje, e por desenho: `restaurants` não
-- tem policy de INSERT, e sem policy o Postgres nega. `profiles` tem
-- `profiles_owner_insert`, que exige `has_role('owner')` no MESMO restaurante —
-- ou seja, para criar o primeiro administrador é preciso já ser administrador.
--
-- Isso não é bug: é o estado correto para um sistema que ainda não decidiu como
-- alguém entra. Afrouxar as policies para resolver seria abrir a criação de
-- tenant para qualquer token autenticado, em toda requisição, para sempre.
--
-- A saída é uma porta só, `create_restaurant`, SECURITY DEFINER, que faz as
-- duas coisas numa transação e cobra na entrada o que as policies não têm como
-- cobrar. As policies continuam fechadas.
--
-- E O SEGUNDO FURO, ACHADO NO CAMINHO
--
-- `restaurants_public_read` era `using (active)`. Sem filtro de restaurante:
-- qualquer um com a chave anon — que vai no bundle do navegador por definição —
-- lia a lista INTEIRA de clientes da plataforma. Medido:
--
--     anon → select name, slug from restaurants
--          → Brasa Burger, Concorrente, Vizinho, Vizinho…
--
-- Não é dado de cliente final, é dado comercial: quem usa o produto, com que
-- nome e sob que slug. Nada no cardápio precisa disso — o menu público resolve
-- mesa e restaurante pelo `short_code`, no SERVIDOR, com o client de admin.
--
-- O que precisava era outra coisa: cinco policies públicas conferem
-- `exists (select 1 from restaurants where ... and active)`, e subquery dentro
-- de policy passa pela RLS de quem consulta. Tirar a leitura do anon zerava o
-- cardápio inteiro — conferido antes de mexer.
--
-- A resposta é uma função SECURITY DEFINER: a pergunta "este restaurante está
-- ativo?" é respondida sem entregar a tabela.
-- =============================================================================

/**
 * Tira acento sem depender da extensão `unaccent`.
 *
 * `unaccent` existe no Supabase, mas é uma extensão a mais para instalar e
 * manter por causa de uma linha. A tabela abaixo cobre o português, que é o
 * escopo declarado (P7: pt-BR).
 */
create or replace function public.unaccent_simples(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    p_texto,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
  );
$$;

/**
 * Este restaurante está ativo?
 *
 * SECURITY DEFINER de propósito: responde a pergunta sem exigir que quem
 * pergunta possa LER `restaurants`. É o que permite fechar a tabela para o
 * anônimo sem quebrar o cardápio público.
 *
 * STABLE, e não VOLATILE, porque roda dentro de policy avaliada por linha: sem
 * isso o planejador chamaria a função uma vez por produto do cardápio.
 */
create or replace function app.restaurant_is_active(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.restaurants r
     where r.id = p_restaurant_id and r.active
  );
$$;

grant execute on function app.restaurant_is_active(uuid) to anon, authenticated;

/**
 * O fuso do restaurante, sem expor a tabela.
 *
 * A policy de categorias precisa dele para decidir se a seção está dentro da
 * janela de serviço. A primeira versão desta migration buscava com
 * `(select timezone from restaurants where id = ...)` — que é exatamente a
 * leitura direta que ela estava tentando fechar. Fechar a porta e deixar a
 * janela aberta não fecha nada.
 */
create or replace function app.restaurant_timezone(p_restaurant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.timezone from public.restaurants r where r.id = p_restaurant_id),
    'America/Sao_Paulo'
  );
$$;

grant execute on function app.restaurant_timezone(uuid) to anon, authenticated;

comment on function app.restaurant_is_active(uuid) is
  'Responde se o restaurante está ativo sem expor a tabela. Usada pelas policies '
  'públicas do cardápio, para o anônimo não conseguir listar os clientes da '
  'plataforma.';

-- -----------------------------------------------------------------------------
-- As cinco policias públicas trocam a subquery pela função.
-- -----------------------------------------------------------------------------
drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon
  using (
    archived_at is null
    and app.restaurant_is_active(restaurant_id)
    and app.is_within_service_window(
      available_from, available_to, days_of_week,
      app.restaurant_timezone(restaurant_id)
    )
  );

-- CUIDADO AQUI. A primeira versão desta migration reescreveu a policy de
-- produtos como `archived_at is null and restaurant_is_active(...)` e apagou,
-- sem querer, TRÊS condições que a original tinha:
--
--   `is_available`        — item marcado como esgotado voltaria ao cardápio;
--   categoria arquivada   — item de seção removida voltaria junto;
--   janela de serviço     — item de "Happy Hour" apareceria às dez da manhã.
--
-- Nenhuma delas quebra nada visível: o cardápio continua abrindo, só que
-- oferecendo o que não deveria. Quem pegou foi um teste do KDS, que confere se
-- "Acabou" some do cardápio anônimo. A troca aqui é só o acesso a
-- `restaurants`; o resto é idêntico à 0013.
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon
  using (
    is_available
    and archived_at is null
    and exists (
      select 1
        from public.categories c
       where c.id = products.category_id
         and c.archived_at is null
         and app.restaurant_is_active(c.restaurant_id)
         and app.is_within_service_window(
               c.available_from, c.available_to, c.days_of_week,
               app.restaurant_timezone(c.restaurant_id))
    )
  );

drop policy if exists modifier_groups_public_read on public.modifier_groups;
create policy modifier_groups_public_read on public.modifier_groups
  for select to anon
  using (archived_at is null and app.restaurant_is_active(restaurant_id));

drop policy if exists modifier_options_public_read on public.modifier_options;
create policy modifier_options_public_read on public.modifier_options
  for select to anon
  using (is_available and archived_at is null and app.restaurant_is_active(restaurant_id));

drop policy if exists product_modifier_groups_public_read on public.product_modifier_groups;
create policy product_modifier_groups_public_read on public.product_modifier_groups
  for select to anon
  using (app.restaurant_is_active(restaurant_id));

-- A tabela sai do alcance do anônimo. O staff continua lendo o próprio
-- restaurante; o cardápio público continua funcionando pela função acima.
drop policy if exists restaurants_public_read on public.restaurants;

-- E o GRANT vai junto. Sem policy o SELECT já é negado, mas privilégio que não
-- serve para nada é privilégio que alguém religa sem querer ao criar a próxima
-- policy — e `check-rls` mede GRANT, então deixá-lo faria o script seguir
-- anunciando que o anônimo lê `restaurants` quando ele não lê mais nada.
revoke select on public.restaurants from anon;

-- =============================================================================
-- CRIAR RESTAURANTE
-- =============================================================================

/**
 * Cria o restaurante e o primeiro administrador, numa transação.
 *
 * O QUE ELA COBRA, e por quê:
 *
 *   1. Precisa estar autenticado. O tenant nasce amarrado a uma pessoa de
 *      verdade, e é essa pessoa que vira administrador.
 *
 *   2. Quem JÁ tem perfil não cria. Um usuário, um restaurante. Sem isso, o
 *      garçom do restaurante A criaria o restaurante B e passaria a ter dois
 *      perfis — e `app.current_restaurant_id()` presume um. Duas linhas em
 *      `profiles` para o mesmo `auth.uid()` fariam a função escolher uma delas
 *      por acaso, que é isolamento de tenant decidido por sorteio.
 *
 *   3. O SLUG é derivado do nome AQUI, no servidor, e nunca aceito do cliente.
 *      Slug escolhido pelo cliente é escolher o endereço público de alguém:
 *      abre a porta para registrar `brasa-burger` antes do Brasa Burger.
 *
 * SECURITY DEFINER porque precisa escrever em duas tabelas que estão fechadas —
 * e é justamente por isso que as três checagens acima vêm antes de qualquer
 * escrita. Função definer sem checagem é um buraco com nome bonito.
 *
 * SQLSTATEs:
 *   45080 não autenticado
 *   45081 já pertence a um restaurante
 *   45082 nome inválido
 */
create or replace function public.create_restaurant(
  p_nome text,
  p_nome_do_administrador text,
  p_timezone text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text := trim(p_nome);
  v_pessoa text := trim(p_nome_do_administrador);
  v_slug text;
  v_restaurante uuid;
begin
  if v_uid is null then
    raise exception 'Entre na sua conta antes de criar o restaurante'
      using errcode = '45080';
  end if;

  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Esta conta já pertence a um restaurante'
      using errcode = '45081',
            hint = 'Cada pessoa pertence a um restaurante. Use outra conta.';
  end if;

  if length(v_nome) < 2 or length(v_nome) > 80 then
    raise exception 'O nome do restaurante precisa ter de 2 a 80 caracteres'
      using errcode = '45082';
  end if;

  if length(v_pessoa) < 2 or length(v_pessoa) > 80 then
    raise exception 'Informe seu nome'
      using errcode = '45082';
  end if;

  -- Slug a partir do nome: minúsculas, sem acento, sem pontuação.
  v_slug := trim(both '-' from
    regexp_replace(
      lower(public.unaccent_simples(v_nome)),
      '[^a-z0-9]+', '-', 'g'
    )
  );

  if v_slug = '' then v_slug := 'restaurante'; end if;

  -- Colisão resolvida com sufixo curto e ALEATÓRIO, nunca sequencial:
  -- `brasa-burger-2` conta ao mundo que existe um `brasa-burger-1`.
  if exists (select 1 from public.restaurants where slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
  end if;

  insert into public.restaurants (name, slug, timezone)
  values (v_nome, v_slug, coalesce(nullif(trim(p_timezone), ''), 'America/Sao_Paulo'))
  returning id into v_restaurante;

  insert into public.profiles (id, restaurant_id, name, roles)
  values (v_uid, v_restaurante, v_pessoa, array['owner']::public.staff_role[]);

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after
  ) values (
    v_restaurante, 'staff', v_uid, 'restaurant.created', 'restaurants', v_restaurante,
    jsonb_build_object('name', v_nome, 'slug', v_slug)
  );

  return jsonb_build_object('restaurant_id', v_restaurante, 'slug', v_slug);
end;
$$;

revoke all on function public.create_restaurant(text, text, text) from public, anon;
grant execute on function public.create_restaurant(text, text, text) to authenticated;

-- =============================================================================
-- MESAS EM LOTE
-- =============================================================================

/**
 * Cria várias mesas de uma vez.
 *
 * O `short_code` NÃO vem daqui nem do cliente: é o default da coluna,
 * `app.generate_short_code(10)`, aleatório. A §10 é explícita — código
 * sequencial ou derivado do número da mesa deixa qualquer pessoa adivinhar o
 * endereço de outra mesa e abrir comanda nela.
 *
 * SQLSTATEs:
 *   45083 sem permissão
 *   45084 quantidade fora do razoável
 */
create or replace function public.create_tables(
  p_quantidade int,
  p_area text default 'Salão',
  p_prefixo text default 'Mesa'
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_area text := coalesce(nullif(trim(p_area), ''), 'Salão');
  -- Só letras, números e espaço: o prefixo entra numa expressão regular logo
  -- abaixo, e um `(` vindo do formulário quebraria a consulta.
  v_prefixo text := coalesce(
    nullif(trim(regexp_replace(coalesce(p_prefixo, ''), '[^[:alnum:] ]', '', 'g')), ''),
    'Mesa'
  );
  v_maior int;
  v_criadas int := 0;
begin
  if not app.has_any_role('owner', 'manager') then
    raise exception 'Sem permissão para criar mesas' using errcode = '45083';
  end if;

  if p_quantidade is null or p_quantidade < 1 or p_quantidade > 200 then
    raise exception 'Informe de 1 a 200 mesas' using errcode = '45084';
  end if;

  -- Continua a numeração de onde parou, olhando só os rótulos com este
  -- prefixo: quem já tem "Mesa 1..8" e cria mais quatro quer "Mesa 9..12", não
  -- quatro mesas duplicadas.
  select coalesce(max(nullif(regexp_replace(label, '^' || v_prefixo || '\s*', ''), '')::int), 0)
    into v_maior
    from public.restaurant_tables
   where restaurant_id = v_restaurante
     and label ~ ('^' || v_prefixo || '\s*[0-9]+$');

  insert into public.restaurant_tables (restaurant_id, label, area)
  select v_restaurante, v_prefixo || ' ' || (v_maior + n), v_area
    from generate_series(1, p_quantidade) as n;

  get diagnostics v_criadas = row_count;
  return v_criadas;
end;
$$;

revoke all on function public.create_tables(int, text, text) from public, anon;
grant execute on function public.create_tables(int, text, text) to authenticated;

-- =============================================================================
-- TAXA DE SERVIÇO É DINHEIRO
-- =============================================================================
-- `restaurants_owner_update` deixa gerente e administrador mudarem qualquer
-- coluna, inclusive `service_fee_pct` — que entra em toda conta da casa. Preço
-- de produto já ia para o audit_log desde a 0013; a taxa não ia para lugar
-- nenhum, e é o mesmo tipo de decisão.
-- =============================================================================
create or replace function app.audit_restaurant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_fee_pct is distinct from old.service_fee_pct
     or new.active is distinct from old.active
     or new.name is distinct from old.name then
    insert into public.audit_log (
      restaurant_id, actor_type, actor_id, action, entity_type, entity_id, before, after
    ) values (
      new.id,
      (case when (select auth.uid()) is null then 'system' else 'staff' end)
        ::public.audit_actor_type,
      (select auth.uid()),
      'restaurant.settings_changed', 'restaurants', new.id,
      jsonb_build_object('name', old.name, 'service_fee_pct', old.service_fee_pct,
                         'active', old.active),
      jsonb_build_object('name', new.name, 'service_fee_pct', new.service_fee_pct,
                         'active', new.active)
    );
  end if;
  return new;
end;
$$;

create trigger audit_restaurant_change
  after update on public.restaurants
  for each row execute function app.audit_restaurant_change();
