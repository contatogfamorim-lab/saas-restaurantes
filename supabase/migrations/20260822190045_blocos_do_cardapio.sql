-- =============================================================================
-- 0045 — Os blocos do cardápio ganham quem os mexa
-- =============================================================================
-- O QUE JÁ EXISTIA, E O QUE FALTAVA
--
-- `menu_layouts` e `menu_blocks` estão no banco desde a 0009, com rascunho,
-- publicação versionada e reversão em um clique. O que nunca foi construído é
-- o que os MOVE — e, sem isso, o cardápio do cliente ignorava o layout inteiro
-- e renderizava categorias em ordem fixa. Duas tabelas paradas há trinta e seis
-- migrations.
--
-- Esta migration dá a elas as quatro operações que faltavam: acrescentar,
-- mover, editar e remover.
--
-- A REGRA QUE IMPEDE O PIOR ERRO
--
-- Categoria sem bloco correspondente CONTINUA APARECENDO no cardápio, no fim.
--
-- É deliberado e é a decisão mais importante daqui. A alternativa — só aparece
-- o que está no layout — significa que cadastrar uma categoria nova e esquecer
-- de arrastá-la para o editor faz a comida sumir do cardápio, sem erro e sem
-- aviso. Um sistema de pedidos que esconde comida em silêncio é pior que um
-- sistema sem editor nenhum.
--
-- Ou seja: o layout ORDENA e ACRESCENTA (banner, destaques), nunca subtrai por
-- omissão. Para esconder, existe `is_hidden`, que é uma escolha explícita.
--
-- O QUE VAI EM `config`
--
--   banner          { imagens: [{ caminho, alt }], intervalo_ms }
--   featured_group  { titulo, origem: 'promocoes'|'manual', produtos: [uuid] }
--   category        { category_id }
--   text            { titulo, corpo }
--
-- Caminho de imagem, id de produto, id de categoria — REFERÊNCIA, nunca cópia.
-- A 0009 já dizia isso no comentário da coluna, e continua valendo: nome e
-- preço vêm de `products`, sempre.
-- =============================================================================

/**
 * Acrescenta um bloco ao rascunho, no fim.
 *
 * Sempre no rascunho: publicar é um ato separado, e mexer direto no layout
 * vigente mudaria o cardápio do cliente no meio do serviço.
 *
 * SQLSTATEs:
 *   45070 sem permissão (herdado de ensure_draft_layout)
 */
create or replace function public.adicionar_bloco(p_tipo text, p_config jsonb default '{}'::jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_layout uuid;
  v_ordem int;
  v_id uuid;
begin
  v_layout := public.ensure_draft_layout();

  select coalesce(max(sort_order), 0) + 1 into v_ordem
    from public.menu_blocks
   where layout_id = v_layout and parent_block_id is null;

  insert into public.menu_blocks (restaurant_id, layout_id, type, sort_order, config)
  values (v_restaurante, v_layout, p_tipo::public.menu_block_type, v_ordem, p_config)
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Troca o bloco de lugar com o vizinho.
 *
 * TROCA, e não "define a posição N". Reordenar mandando a lista inteira do
 * navegador seria aceitar do cliente a ordem final — e um pedido concorrente,
 * de outro aparelho, sobrescreveria o do primeiro sem ninguém notar. Trocar com
 * o vizinho é uma operação pequena e comutativa: duas pessoas mexendo ao mesmo
 * tempo produzem uma ordem estranha, nunca uma ordem perdida.
 */
create or replace function public.mover_bloco(p_bloco uuid, p_direcao text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_layout uuid;
  v_ordem int;
  v_vizinho uuid;
  v_ordem_vizinho int;
begin
  if not app.has_menu_permission('menu.structure') then
    raise exception 'Sem permissão para editar a estrutura do cardápio'
      using errcode = '45070';
  end if;

  select layout_id, sort_order into v_layout, v_ordem
    from public.menu_blocks
   where id = p_bloco and restaurant_id = app.current_restaurant_id();

  if v_layout is null then
    raise exception 'Bloco não encontrado' using errcode = '45071';
  end if;

  if p_direcao = 'cima' then
    select id, sort_order into v_vizinho, v_ordem_vizinho
      from public.menu_blocks
     where layout_id = v_layout and parent_block_id is null and sort_order < v_ordem
     order by sort_order desc limit 1;
  else
    select id, sort_order into v_vizinho, v_ordem_vizinho
      from public.menu_blocks
     where layout_id = v_layout and parent_block_id is null and sort_order > v_ordem
     order by sort_order asc limit 1;
  end if;

  -- Já é o primeiro ou o último: não é erro, é o fim da lista.
  if v_vizinho is null then return; end if;

  update public.menu_blocks set sort_order = v_ordem_vizinho where id = p_bloco;
  update public.menu_blocks set sort_order = v_ordem where id = v_vizinho;
end;
$$;

/** Muda a configuração e a visibilidade de um bloco. */
create or replace function public.atualizar_bloco(
  p_bloco uuid,
  p_config jsonb default null,
  p_oculto boolean default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.has_menu_permission('menu.structure') then
    raise exception 'Sem permissão para editar a estrutura do cardápio'
      using errcode = '45070';
  end if;

  update public.menu_blocks
     set config = coalesce(p_config, config),
         is_hidden = coalesce(p_oculto, is_hidden),
         updated_at = now()
   where id = p_bloco and restaurant_id = app.current_restaurant_id();

  if not found then
    raise exception 'Bloco não encontrado' using errcode = '45071';
  end if;
end;
$$;

/** Tira o bloco do rascunho. */
create or replace function public.remover_bloco(p_bloco uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.has_menu_permission('menu.structure') then
    raise exception 'Sem permissão para editar a estrutura do cardápio'
      using errcode = '45070';
  end if;

  delete from public.menu_blocks
   where id = p_bloco and restaurant_id = app.current_restaurant_id();

  if not found then
    raise exception 'Bloco não encontrado' using errcode = '45071';
  end if;
end;
$$;

revoke all on function public.adicionar_bloco(text, jsonb) from public, anon;
revoke all on function public.mover_bloco(uuid, text) from public, anon;
revoke all on function public.atualizar_bloco(uuid, jsonb, boolean) from public, anon;
revoke all on function public.remover_bloco(uuid) from public, anon;
grant execute on function public.adicionar_bloco(text, jsonb) to authenticated;
grant execute on function public.mover_bloco(uuid, text) to authenticated;
grant execute on function public.atualizar_bloco(uuid, jsonb, boolean) to authenticated;
grant execute on function public.remover_bloco(uuid) to authenticated;

-- =============================================================================
-- O QUE O CARDÁPIO DO CLIENTE LÊ
-- =============================================================================

/**
 * Os blocos VIGENTES de um restaurante, já filtrados por janela de horário.
 *
 * `security definer` porque o celular do cliente é `anon`, e `menu_blocks` não
 * está entre as tabelas que o anônimo lê — nem deve estar: manter essa lista
 * curta é o que o `check-rls` verifica nas duas direções.
 *
 * Devolve vazio quando não há layout publicado, e o cardápio cai no
 * comportamento de sempre: categorias em ordem de `sort_order`. Restaurante que
 * nunca abriu o editor não perde nada.
 */
create or replace function public.blocos_do_cardapio(p_restaurante uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('id', b.id, 'tipo', b.type, 'config', b.config)
    order by b.sort_order
  ), '[]'::jsonb)
  from public.menu_blocks b
  join public.menu_layouts l on l.id = b.layout_id
  where b.restaurant_id = p_restaurante
    and l.status = 'published'
    and b.parent_block_id is null
    and not b.is_hidden
    -- A mesma janela de serviço que as categorias respeitam desde a 0013: um
    -- banner de happy hour não aparece às dez da manhã.
    and app.is_within_service_window(
          b.visible_from, b.visible_to, b.days_of_week,
          app.restaurant_timezone(p_restaurante)
        );
$$;

revoke all on function public.blocos_do_cardapio(uuid) from public, anon, authenticated;
grant execute on function public.blocos_do_cardapio(uuid) to service_role;

comment on function public.blocos_do_cardapio(uuid) is
  'Blocos do layout publicado, na ordem, sem os ocultos e dentro da janela de '
  'horário. Vazio = cardápio usa a ordem das categorias.';
