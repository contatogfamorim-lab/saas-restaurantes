-- =============================================================================
-- 0030 — Editor de cardápio (spec §12)
-- =============================================================================
-- O BURACO QUE ESTA MIGRATION FECHA PRIMEIRO
--
-- `menu.price` é do dono, e delegável pessoa a pessoa, porque a §12.9 diz que
-- alterar preço é o vetor de fraude mais comum. Isso estava sendo cumprido
-- pelo trigger `products_column_guard` — que é BEFORE UPDATE.
--
-- Só que preço também se define CRIANDO um produto. E a policy de escrita
-- liberava INSERT para quem tivesse QUALQUER permissão de cardápio, incluindo
-- `menu.availability`, que a cozinha tem. Medido:
--
--     cozinha → insert into products (name, price_cents)
--               values ('PRODUTO FANTASMA DA COZINHA', 9900)   → passou
--
-- Ou seja: quem não podia mexer no preço de um item podia inventar um item
-- inteiro com o preço que quisesse. A regra de ouro da §12.9 valia só para o
-- caminho que alguém lembrou de fechar.
--
-- DELETE estava barrado, mas por falta de GRANT — sorte, não desenho. Aqui
-- vira decisão explícita: produto não se apaga, se arquiva, porque `order_items`
-- aponta para ele e um histórico com produto sumido é um relatório quebrado.
-- =============================================================================

drop policy if exists products_staff_write on public.products;

-- Criar item é ESTRUTURA, e criar item com preço é PREÇO. As duas coisas,
-- porque criar um produto é inevitavelmente definir quanto ele custa.
create policy products_staff_insert on public.products
  for insert to authenticated
  with check (
    restaurant_id = app.current_restaurant_id()
    and app.has_menu_permission('menu.structure')
  );

-- O UPDATE continua com o portão largo: quem separa as colunas é o trigger,
-- porque policy é por LINHA e a regra aqui é por COLUNA.
create policy products_staff_update on public.products
  for update to authenticated
  using (
    restaurant_id = app.current_restaurant_id()
    and (app.has_menu_permission('menu.availability')
         or app.has_menu_permission('menu.content')
         or app.has_menu_permission('menu.price')
         or app.has_menu_permission('menu.structure'))
  )
  with check (
    restaurant_id = app.current_restaurant_id()
    and (app.has_menu_permission('menu.availability')
         or app.has_menu_permission('menu.content')
         or app.has_menu_permission('menu.price')
         or app.has_menu_permission('menu.structure'))
  );

-- Nenhuma policy de DELETE, de propósito: sem policy, ninguém apaga. O caminho
-- é `archive_product`, que preserva o histórico.
revoke delete on public.products from authenticated;

/**
 * Guarda de coluna — agora também no INSERT.
 *
 * Na criação não existe `old`, então a pergunta muda: não é "mudou o preço?",
 * é "está nascendo com preço?". Item nascendo a R$ 99 é a mesma decisão de
 * negócio que mudar um de R$ 40 para R$ 99.
 *
 * LIMITE CONHECIDO, herdado: `auth.uid()` é nulo sob service_role, então este
 * guard não vale para seed, migração ou job. As mutações do editor DEVEM usar
 * o client autenticado do funcionário.
 */
create or replace function app.products_column_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;  -- seed / migração / job do sistema
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.price_cents, 0) > 0
       and not app.has_menu_permission('menu.price') then
      raise exception 'Sem permissão menu.price para criar "%" com preço', new.name
        using errcode = 'insufficient_privilege',
              hint = 'Crie o item sem preço e peça a quem tem a permissão para precificar.';
    end if;
    return new;
  end if;

  if new.price_cents is distinct from old.price_cents
     and not app.has_menu_permission('menu.price') then
    raise exception 'Sem permissão menu.price para alterar o preço de "%"', old.name
      using errcode = 'insufficient_privilege';
  end if;

  -- Arquivar desliga a disponibilidade junto, e isso NÃO é uma mudança de
  -- disponibilidade que precise da permissão dela: é consequência de arquivar,
  -- que tem portão próprio logo abaixo. Sem esta exceção, quem recebeu
  -- `menu.structure` delegado sem `menu.availability` não conseguiria arquivar
  -- nada — a função certa barrada pela guarda da coluna errada.
  if new.is_available is distinct from old.is_available
     and new.archived_at is not distinct from old.archived_at
     and not app.has_menu_permission('menu.availability') then
    raise exception 'Sem permissão menu.availability para alterar a disponibilidade de "%"', old.name
      using errcode = 'insufficient_privilege';
  end if;

  if (new.name is distinct from old.name
      or new.description is distinct from old.description
      or new.image_url is distinct from old.image_url)
     and not app.has_menu_permission('menu.content') then
    raise exception 'Sem permissão menu.content para editar "%"', old.name
      using errcode = 'insufficient_privilege';
  end if;

  -- Arquivar e desarquivar é estrutura: tira o item do cardápio inteiro, e é
  -- a alternativa ao DELETE que não existe.
  if new.archived_at is distinct from old.archived_at
     and not app.has_menu_permission('menu.structure') then
    raise exception 'Sem permissão menu.structure para arquivar "%"', old.name
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists products_column_guard on public.products;
create trigger products_column_guard
  before insert or update on public.products
  for each row execute function app.products_column_guard();

-- =============================================================================
-- TRILHA — o que muda no cardápio e quem mudou
-- =============================================================================
-- Preço já ia para o audit_log desde a 0013. Faltavam as outras três, e cada
-- uma some de um jeito diferente:
--
--   disponibilidade — "acabou" tira o item do ar sem deixar rastro, e um item
--                     que vive esgotado é indistinguível de sabotagem;
--   arquivamento    — some do cardápio inteiro;
--   conteúdo        — trocar a foto ou a descrição muda o que o cliente
--                     acredita estar comprando (§4, publicidade enganosa).
-- =============================================================================
create or replace function app.audit_product_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acao text;
  v_antes jsonb;
  v_depois jsonb;
begin
  if tg_op = 'INSERT' then
    v_acao := 'product.created';
    v_antes := null;
    v_depois := jsonb_build_object(
      'name', new.name, 'price_cents', new.price_cents,
      'category_id', new.category_id, 'is_available', new.is_available
    );

  elsif new.archived_at is distinct from old.archived_at then
    v_acao := case when new.archived_at is null then 'product.restored'
                   else 'product.archived' end;
    v_antes := jsonb_build_object('name', old.name, 'archived_at', old.archived_at);
    v_depois := jsonb_build_object('name', new.name, 'archived_at', new.archived_at);

  elsif new.is_available is distinct from old.is_available then
    v_acao := case when new.is_available then 'product.available'
                   else 'product.unavailable' end;
    v_antes := jsonb_build_object('name', old.name, 'is_available', old.is_available);
    v_depois := jsonb_build_object('name', new.name, 'is_available', new.is_available);

  elsif new.name is distinct from old.name
     or new.description is distinct from old.description
     or new.image_url is distinct from old.image_url then
    v_acao := 'product.content_changed';
    -- Só o que MUDOU, e a foto entra como "trocou" e não como URL: o log é
    -- para alguém varrer, não para reconstruir o produto.
    v_antes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when new.name is distinct from old.name then old.name end,
      'description', case when new.description is distinct from old.description
                          then left(coalesce(old.description, ''), 80) end,
      'foto', case when new.image_url is distinct from old.image_url
                   then (old.image_url is not null) end
    ));
    v_depois := jsonb_strip_nulls(jsonb_build_object(
      'name', case when new.name is distinct from old.name then new.name end,
      'description', case when new.description is distinct from old.description
                          then left(coalesce(new.description, ''), 80) end,
      'foto', case when new.image_url is distinct from old.image_url
                   then (new.image_url is not null) end
    ));

  else
    return new;   -- mexeu em coisa que não vale trilha (sort_order, prep_minutes)
  end if;

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, before, after
  ) values (
    new.restaurant_id,
    (case when (select auth.uid()) is null then 'system' else 'staff' end)
      ::public.audit_actor_type,
    (select auth.uid()),
    v_acao, 'products', new.id, v_antes, v_depois
  );

  return new;
end;
$$;

create trigger audit_product_change
  after insert or update on public.products
  for each row execute function app.audit_product_change();

-- =============================================================================
-- ARQUIVAR — a alternativa ao DELETE que não existe
-- =============================================================================

/**
 * Tira um produto do cardápio sem apagá-lo.
 *
 * `order_items` aponta para `products`, e a comanda de ontem precisa continuar
 * dizendo o que foi vendido. Apagar o produto quebraria o relatório e a conta
 * de uma mesa que ainda está aberta.
 *
 * SQLSTATEs:
 *   45060 sem permissão
 *   45061 produto não encontrado neste restaurante
 *   45062 item está numa comanda aberta
 */
create or replace function public.archive_product(p_product_id uuid, p_arquivar boolean default true)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
begin
  if not app.has_menu_permission('menu.structure') then
    raise exception 'Sem permissão para arquivar itens do cardápio'
      using errcode = '45060';
  end if;

  if not exists (
    select 1 from public.products
     where id = p_product_id and restaurant_id = v_restaurante
  ) then
    raise exception 'Produto não encontrado' using errcode = '45061';
  end if;

  -- Arquivar item que está numa comanda aberta deixaria a mesa com um item
  -- que o cardápio não conhece mais. Esperar a comanda fechar custa minutos.
  if p_arquivar and exists (
    select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.table_sessions s on s.id = o.session_id
     where oi.product_id = p_product_id
       and s.status in ('open', 'closing')
       and oi.status not in ('cancelled', 'out_of_stock')
  ) then
    raise exception 'Este item está numa comanda aberta'
      using errcode = '45062',
            hint = 'Para tirar do cardápio agora, marque como esgotado.';
  end if;

  update public.products
     set archived_at = case when p_arquivar then now() else null end,
         archived_by = case when p_arquivar then auth.uid() else null end,
         -- Item arquivado sai do ar junto: deixar `is_available = true` num
         -- item arquivado é um estado que não quer dizer nada.
         is_available = case when p_arquivar then false else is_available end
   where id = p_product_id and restaurant_id = v_restaurante;
end;
$$;

revoke all on function public.archive_product(uuid, boolean) from public, anon;
grant execute on function public.archive_product(uuid, boolean) to authenticated;

-- =============================================================================
-- PUBLICAR E REVERTER (spec §12.8)
-- =============================================================================
-- QUAL CARDÁPIO ESTÁ NO AR NÃO PODE SER UMA CONTA
--
-- O desenho original marcava toda versão já publicada como `published` e
-- deixava "o vigente" ser o de `published_at` mais recente. Isso empata:
-- `now()` é o horário da TRANSAÇÃO, não do comando. Publicar duas vezes na
-- mesma transação carimba o mesmo instante, e `order by published_at desc
-- limit 1` passa a devolver uma das duas por acaso. Medido:
--
--     versao 2 publicada em 2026-08-24 18:50:20.856649+00
--     versao 3 publicada em 2026-08-24 18:50:20.856649+00
--
-- Trocar para `clock_timestamp()` faria o teste passar e deixaria o problema:
-- a pergunta "qual cardápio o cliente está vendo?" continuaria sendo uma
-- ordenação, e ordenação empata. O que o banco precisa é não conseguir
-- representar dois layouts vivos.
--
-- Daí o terceiro estado. `published` passa a significar NO AR, um por
-- restaurante, garantido por índice único. As versões que saíram viram
-- `archived` e guardam `published_at` como histórico — é delas que a reversão
-- da §12.8 escolhe.
-- =============================================================================

alter type public.menu_layout_status add value if not exists 'archived';

-- A partir daqui, `published` quer dizer "é este que está no ar".
create unique index if not exists menu_layouts_one_published
  on public.menu_layouts (restaurant_id) where status = 'published';

/**
 * Devolve o rascunho aberto, criando um se não houver.
 *
 * Um restaurante pode não ter rascunho nenhum — é o estado de quem acabou de
 * ser criado, e também o de quem publicou antes desta migration existir. Sem
 * isto, abrir o editor de layout dava "não há rascunho para publicar", que é
 * uma mensagem sobre publicar em uma tela onde ninguém pediu para publicar.
 *
 * O rascunho novo nasce como cópia do que está no ar. Começar em branco faria
 * o editor parecer que apagou o cardápio.
 *
 * SQLSTATEs:
 *   45070 sem permissão para editar a estrutura
 */
create or replace function public.ensure_draft_layout()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_rascunho uuid;
  v_vigente uuid;
begin
  if not app.has_menu_permission('menu.structure') then
    raise exception 'Sem permissão para editar a estrutura do cardápio'
      using errcode = '45070';
  end if;

  select id into v_rascunho
    from public.menu_layouts
   where restaurant_id = v_restaurante and status = 'draft';

  if found then
    return v_rascunho;
  end if;

  insert into public.menu_layouts (restaurant_id, status, version)
  select v_restaurante, 'draft', coalesce(max(version), 0) + 1
    from public.menu_layouts where restaurant_id = v_restaurante
  returning id into v_rascunho;

  select id into v_vigente
    from public.menu_layouts
   where restaurant_id = v_restaurante and status = 'published';

  if v_vigente is not null then
    insert into public.menu_blocks (
      restaurant_id, layout_id, parent_block_id, type, sort_order, config,
      is_hidden, visible_from, visible_to, days_of_week
    )
    select restaurant_id, v_rascunho, parent_block_id, type, sort_order, config,
           is_hidden, visible_from, visible_to, days_of_week
      from public.menu_blocks
     where layout_id = v_vigente;
  end if;

  return v_rascunho;
end;
$$;

revoke all on function public.ensure_draft_layout() from public, anon;
grant execute on function public.ensure_draft_layout() to authenticated;

/**
 * Publica o rascunho do layout.
 *
 * O rascunho vira publicado e um novo rascunho nasce como CÓPIA dele — assim
 * quem publicou às 18h continua editando às 18h05 sem mexer no que o cliente
 * está vendo.
 *
 * A versão publicada anterior NÃO é apagada. Ela é o que a reversão em um
 * clique da §12.8 traz de volta.
 *
 * SQLSTATEs:
 *   45063 sem permissão para publicar
 *   45064 não há rascunho para publicar
 */
create or replace function public.publish_menu_layout()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_rascunho public.menu_layouts;
  v_nova_versao int;
  v_novo_rascunho uuid;
begin
  if not app.has_menu_permission('menu.publish') then
    raise exception 'Sem permissão para publicar o cardápio' using errcode = '45063';
  end if;

  select * into v_rascunho
    from public.menu_layouts
   where restaurant_id = v_restaurante and status = 'draft'
   for update;

  if not found then
    raise exception 'Não há rascunho para publicar' using errcode = '45064';
  end if;

  -- O que estava no ar sai primeiro: o índice único não deixa dois `published`
  -- coexistirem nem por um instante dentro da transação.
  update public.menu_layouts
     set status = 'archived'
   where restaurant_id = v_restaurante and status = 'published';

  update public.menu_layouts
     set status = 'published', published_at = now(), published_by = auth.uid()
   where id = v_rascunho.id;

  select coalesce(max(version), 0) + 1 into v_nova_versao
    from public.menu_layouts where restaurant_id = v_restaurante;

  insert into public.menu_layouts (restaurant_id, status, version)
  values (v_restaurante, 'draft', v_nova_versao)
  returning id into v_novo_rascunho;

  -- O novo rascunho começa como cópia do que acabou de ir ao ar.
  insert into public.menu_blocks (
    restaurant_id, layout_id, parent_block_id, type, sort_order, config,
    is_hidden, visible_from, visible_to, days_of_week
  )
  select restaurant_id, v_novo_rascunho, parent_block_id, type, sort_order, config,
         is_hidden, visible_from, visible_to, days_of_week
    from public.menu_blocks
   where layout_id = v_rascunho.id;

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after
  ) values (
    v_restaurante, 'staff', auth.uid(), 'menu.published', 'menu_layouts',
    v_rascunho.id, jsonb_build_object('version', v_rascunho.version)
  );

  return jsonb_build_object(
    'publicado', v_rascunho.id,
    'versao', v_rascunho.version,
    'novo_rascunho', v_novo_rascunho
  );
end;
$$;

revoke all on function public.publish_menu_layout() from public, anon;
grant execute on function public.publish_menu_layout() to authenticated;

/**
 * Volta para uma versão publicada anterior (spec §12.8, "reversão em um clique").
 *
 * Não desfaz nem apaga: republica. A versão errada continua no histórico com o
 * `published_at` dela, e quem quiser entender o que aconteceu consegue.
 *
 * SQLSTATEs:
 *   45063 sem permissão para publicar
 *   45065 versão não encontrada
 */
create or replace function public.revert_menu_layout(p_version int)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_alvo public.menu_layouts;
begin
  if not app.has_menu_permission('menu.publish') then
    raise exception 'Sem permissão para publicar o cardápio' using errcode = '45063';
  end if;

  select * into v_alvo
    from public.menu_layouts
   where restaurant_id = v_restaurante
     and version = p_version
     and status = 'archived';   -- rascunho não se reverte, se publica

  if not found then
    raise exception 'Versão % não encontrada entre as já publicadas', p_version
      using errcode = '45065';
  end if;

  update public.menu_layouts
     set status = 'archived'
   where restaurant_id = v_restaurante and status = 'published';

  -- `published_at` NÃO é reescrito: ele conta quando aquela versão foi feita, e
  -- sobrescrever apagaria a informação de qual é mais antiga — que é
  -- justamente o que alguém procura ao investigar o que aconteceu.
  update public.menu_layouts
     set status = 'published'
   where id = v_alvo.id;

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after
  ) values (
    v_restaurante, 'staff', auth.uid(), 'menu.reverted', 'menu_layouts',
    v_alvo.id, jsonb_build_object('version', p_version)
  );

  return jsonb_build_object('vigente', v_alvo.id, 'versao', p_version);
end;
$$;

revoke all on function public.revert_menu_layout(int) from public, anon;
grant execute on function public.revert_menu_layout(int) to authenticated;

-- =============================================================================
-- DELEGAÇÃO DE PERMISSÃO (spec §12.9)
-- =============================================================================
-- A VALIDAÇÃO PRECISA SER CONSTRAINT, NÃO FUNÇÃO
--
-- `set_menu_permissions` confere se a permissão pedida está na lista das seis
-- delegáveis. Só que a policy `profiles_owner_update` não restringe coluna, e
-- por isso o caminho direto ignorava a conferência inteira. Medido:
--
--     dono → update profiles set permissions = array['menu.price',
--                                    'permissao.inventada','*']       → gravou
--
-- Hoje uma string inventada é inerte: `can()` só olha `permissions` para as
-- ações delegáveis, e `has_menu_permission` compara com a lista. O estrago é
-- de amanhã — no dia em que alguém checar `permissions.includes(x)` para uma
-- ação que não é delegável, um valor plantado hoje vira permissão de verdade.
--
-- Uma CHECK constraint não tem caminho de fora: vale para o UPDATE direto, para
-- a função, para o service_role e para qualquer coisa que ainda não existe.
-- =============================================================================

/**
 * As seis permissões delegáveis (spec §12.9).
 *
 * Espelha `DELEGATABLE_PERMISSIONS` de `lib/permissions.ts`. A duplicação entre
 * banco e aplicação é a mesma da matriz de permissão, e pelo mesmo motivo: são
 * duas camadas de aplicação, e a API pode ser contornada. `tests/db/cardapio`
 * confere que as duas listas não se separaram.
 */
create or replace function app.delegatable_permissions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'menu.availability', 'menu.content', 'menu.price',
    'menu.structure', 'menu.publish', 'menu.promotion'
  ]::text[];
$$;

-- A lista vai LITERAL na constraint, e não pela função acima, de propósito:
-- CHECK que depende de função continua valendo a definição antiga quando a
-- função muda — o Postgres não revalida a tabela. Constraint mentindo em
-- silêncio é pior que constraint repetida. O teste amarra as duas.
alter table public.profiles
  drop constraint if exists profiles_permissions_delegatable;

alter table public.profiles
  add constraint profiles_permissions_delegatable
  check (permissions <@ array[
    'menu.availability', 'menu.content', 'menu.price',
    'menu.structure', 'menu.publish', 'menu.promotion'
  ]::text[]);

comment on constraint profiles_permissions_delegatable on public.profiles is
  'Só as seis permissões delegáveis da §12.9 entram aqui. Vale para o UPDATE '
  'direto, não só para set_menu_permissions().';

/**
 * Concede ou revoga permissões de cardápio pessoa a pessoa.
 *
 * TRÊS REGRAS, e as três já existem em outro lugar do sistema — aqui elas são
 * repetidas no banco porque a §10.3 manda a autorização acontecer na camada de
 * dados, em toda consulta:
 *
 *   1. só quem administra delega (`staff.manage`);
 *   2. NINGUÉM edita as próprias permissões, administrador incluído — é onde o
 *      escalonamento de privilégio começa. O trigger
 *      `forbid_self_role_escalation` já barra isso em `profiles`; aqui a
 *      mensagem é clara em vez de um erro de trigger;
 *   3. só as seis permissões delegáveis. Aceitar uma string qualquer deixaria
 *      `profiles.permissions` virar um canal para inventar permissão.
 *
 * SQLSTATEs:
 *   45066 sem permissão para gerenciar equipe
 *   45067 ninguém edita as próprias permissões
 *   45068 permissão não delegável
 *   45069 funcionário não encontrado neste restaurante
 */
create or replace function public.set_menu_permissions(
  p_profile_id uuid,
  p_permissions text[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_delegaveis constant text[] := app.delegatable_permissions();
  v_invalidas text[];
  v_antes text[];
begin
  if not app.has_any_role('owner') then
    raise exception 'Só quem administra o restaurante delega permissões'
      using errcode = '45066';
  end if;

  if p_profile_id = auth.uid() then
    raise exception 'Ninguém edita as próprias permissões'
      using errcode = '45067',
            hint = 'Peça a outro administrador.';
  end if;

  select array_agg(p) into v_invalidas
    from unnest(coalesce(p_permissions, array[]::text[])) as p
   where p <> all(v_delegaveis);

  if v_invalidas is not null then
    raise exception 'Permissão não delegável: %', array_to_string(v_invalidas, ', ')
      using errcode = '45068';
  end if;

  select permissions into v_antes
    from public.profiles
   where id = p_profile_id and restaurant_id = v_restaurante;

  if not found then
    raise exception 'Funcionário não encontrado' using errcode = '45069';
  end if;

  update public.profiles
     set permissions = coalesce(p_permissions, array[]::text[])
   where id = p_profile_id and restaurant_id = v_restaurante;

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_restaurante, 'staff', auth.uid(), 'staff.permissions_changed', 'profiles',
    p_profile_id,
    jsonb_build_object('permissions', coalesce(v_antes, array[]::text[])),
    jsonb_build_object('permissions', coalesce(p_permissions, array[]::text[]))
  );
end;
$$;

revoke all on function public.set_menu_permissions(uuid, text[]) from public, anon;
grant execute on function public.set_menu_permissions(uuid, text[]) to authenticated;

comment on function public.set_menu_permissions(uuid, text[]) is
  'Delegação das permissões de cardápio (spec §12.9). Owner-only, nunca sobre '
  'si mesmo, e só as seis da lista.';
