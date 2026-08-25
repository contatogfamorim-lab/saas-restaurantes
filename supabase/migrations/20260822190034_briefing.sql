-- =============================================================================
-- 0034 — Briefing: o sistema nasce configurado, não vazio
-- =============================================================================
-- O PROBLEMA
--
-- O onboarding da 0032 cria restaurante e mesas, e entrega um sistema em
-- branco: nenhuma categoria, nenhum produto, nada para olhar. Quem acabou de
-- entrar encara um cardápio vazio e não tem por onde começar — e quem está
-- avaliando o produto fecha a aba.
--
-- O briefing pergunta o que a casa é (tipo de cozinha, quantas mesas, cidade) e
-- gera a estrutura a partir disso.
--
-- PREÇO NÃO SE INVENTA
--
-- Os produtos gerados nascem com `price_cents = 0` e FORA DO AR. O sistema
-- conhece os pratos que uma hamburgueria costuma ter; não conhece quanto ELA
-- cobra. Chutar um preço aqui seria o sistema afirmando um valor sobre o
-- negócio de outra pessoa — e o resto do projeto inteiro foi construído para
-- que preço nunca seja adivinhado (§10.1, congelamento no pedido, `menu.price`
-- exclusivo do dono).
--
-- Nascer fora do ar é a outra metade: item sem preço no cardápio do cliente
-- seria "R$ 0,00", que é pior que não aparecer.
--
-- A DEMONSTRAÇÃO EXPIRA
--
-- O modo demo gera um restaurante em OPERAÇÃO — mesa ocupada, pedido esperando
-- aprovação, prato na passagem, comanda aberta no caixa. Serve para alguém ver
-- o sistema vivo em vez de vazio.
--
-- E some sozinho em 3 horas. Sem isso, um endereço público acumularia um
-- restaurante-fantasma por visitante até o banco free encher. A limpeza é
-- oportunista, sem cron: roda quando alguém cria a próxima demo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Restaurante com prazo de validade.
--
-- `null` é o normal: restaurante de verdade não expira. Só a demo carrega data.
-- -----------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists expires_at timestamptz;

comment on column public.restaurants.expires_at is
  'Só a demonstração tem prazo. NULL = restaurante de verdade, permanente.';

create index if not exists restaurants_expiram_idx
  on public.restaurants (expires_at) where expires_at is not null;

-- -----------------------------------------------------------------------------
-- A marca de que o briefing JÁ foi respondido.
--
-- Separada das respostas de propósito. `restaurant_briefing` guarda o que foi
-- respondido e some em 3 horas; esta coluna guarda apenas QUE foi respondido, e
-- é permanente.
--
-- Usar a existência da linha como porteiro seria um bug com relógio: o
-- restaurante passaria pelo briefing, tocaria três horas de serviço, e na
-- manhã seguinte o sistema o barraria na porta perguntando de novo que tipo de
-- comida ele vende.
-- -----------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists briefing_at timestamptz;

comment on column public.restaurants.briefing_at is
  'Quando o briefing foi respondido. NULL = primeira entrada, o wizard exige. '
  'Permanente, ao contrário das respostas em restaurant_briefing.';

-- Os restaurantes que já existiam nasceram antes desta pergunta existir. Marcar
-- como respondidos é o único jeito de o porteiro novo não trancar do lado de
-- fora quem já estava dentro — inclusive o restaurante de produção.
update public.restaurants set briefing_at = created_at where briefing_at is null;

-- -----------------------------------------------------------------------------
-- As respostas do briefing.
--
-- Guardadas por 3 horas, e não para sempre: elas servem para regerar se algo
-- falhar no meio e para a tela seguinte saber o que foi respondido. Depois
-- disso o que importa já virou categoria, produto e mesa — a resposta crua
-- vira histórico de ninguém.
-- -----------------------------------------------------------------------------
create table public.restaurant_briefing (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  respostas     jsonb       not null,
  expires_at    timestamptz not null default now() + interval '3 hours',
  created_at    timestamptz not null default now(),
  check (jsonb_typeof(respostas) = 'object')
);

alter table public.restaurant_briefing enable row level security;

create policy briefing_staff_read on public.restaurant_briefing
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

create policy briefing_owner_write on public.restaurant_briefing
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner'));

-- O GRANT, que é o que a policy pressupõe.
--
-- Esqueci na primeira versão desta migration e o briefing morreu com
-- "permission denied for table restaurant_briefing" — exatamente o erro que a
-- 0013 já tinha documentado: os privilégios padrão do Supabase dão só `Dxtm`,
-- e sem GRANT explícito a policy nunca chega a ser avaliada. A tabela parece
-- protegida e está inacessível.
grant select, insert, update, delete on public.restaurant_briefing to authenticated;

-- =============================================================================
-- O CATÁLOGO POR TIPO DE COZINHA
-- =============================================================================
-- Em SQL, e não em TypeScript, para a geração inteira caber numa transação: ou
-- o restaurante nasce completo, ou não nasce. Metade de um cardápio criado é
-- pior que nenhum, porque ninguém sabe o que faltou.
--
-- Os nomes são os pratos que O TIPO costuma ter, não os pratos daquela casa.
-- É ponto de partida para editar, e a tela diz isso.
-- =============================================================================
create or replace function app.catalogo_por_cozinha(p_tipo text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (jsonb_build_object(
      'hamburgueria', jsonb_build_array(
        jsonb_build_object('categoria','Burgers','estacao','cozinha','itens',
          jsonb_build_array('Smash Clássico','Smash Duplo','Cheddar Bacon','Frango Crocante','Veggie')),
        jsonb_build_object('categoria','Acompanhamentos','estacao','cozinha','itens',
          jsonb_build_array('Batata frita','Batata com cheddar','Onion rings','Nuggets')),
        jsonb_build_object('categoria','Bebidas','estacao','bar','itens',
          jsonb_build_array('Refrigerante lata','Suco natural','Água','Cerveja long neck','Milk-shake')),
        jsonb_build_object('categoria','Sobremesas','estacao','cozinha','itens',
          jsonb_build_array('Brownie com sorvete','Petit gateau'))
      ),
      'pizzaria', jsonb_build_array(
        jsonb_build_object('categoria','Pizzas salgadas','estacao','cozinha','itens',
          jsonb_build_array('Margherita','Calabresa','Portuguesa','Quatro queijos','Frango com catupiry','Pepperoni')),
        jsonb_build_object('categoria','Pizzas doces','estacao','cozinha','itens',
          jsonb_build_array('Chocolate','Romeu e Julieta','Banana com canela')),
        jsonb_build_object('categoria','Entradas','estacao','cozinha','itens',
          jsonb_build_array('Pão de alho','Bruschetta')),
        jsonb_build_object('categoria','Bebidas','estacao','bar','itens',
          jsonb_build_array('Refrigerante 2L','Suco','Água','Cerveja','Vinho tinto taça'))
      ),
      'japonesa', jsonb_build_array(
        jsonb_build_object('categoria','Sushi','estacao','cozinha','itens',
          jsonb_build_array('Niguiri salmão','Sashimi salmão','Hossomaki pepino','Uramaki Filadélfia')),
        jsonb_build_object('categoria','Combinados','estacao','cozinha','itens',
          jsonb_build_array('Combinado 20 peças','Combinado 40 peças','Combinado vegetariano')),
        jsonb_build_object('categoria','Pratos quentes','estacao','cozinha','itens',
          jsonb_build_array('Yakisoba','Tempurá','Guioza','Missoshiru')),
        jsonb_build_object('categoria','Bebidas','estacao','bar','itens',
          jsonb_build_array('Chá verde','Refrigerante','Saquê','Água'))
      ),
      'brasileira', jsonb_build_array(
        jsonb_build_object('categoria','Pratos principais','estacao','cozinha','itens',
          jsonb_build_array('Feijoada','Picanha na chapa','Frango grelhado','Filé à parmegiana','Moqueca')),
        jsonb_build_object('categoria','Executivos','estacao','cozinha','itens',
          jsonb_build_array('Executivo de carne','Executivo de frango','Executivo de peixe')),
        jsonb_build_object('categoria','Acompanhamentos','estacao','cozinha','itens',
          jsonb_build_array('Arroz e feijão','Farofa','Vinagrete','Batata frita')),
        jsonb_build_object('categoria','Bebidas','estacao','bar','itens',
          jsonb_build_array('Suco natural','Refrigerante','Cerveja','Caipirinha','Água'))
      ),
      'bar', jsonb_build_array(
        jsonb_build_object('categoria','Petiscos','estacao','cozinha','itens',
          jsonb_build_array('Porção de calabresa','Frango a passarinho','Isca de peixe','Bolinho de bacalhau','Batata frita')),
        jsonb_build_object('categoria','Chopp e cerveja','estacao','bar','itens',
          jsonb_build_array('Chopp claro','Chopp escuro','Cerveja long neck','Balde de cerveja')),
        jsonb_build_object('categoria','Drinks','estacao','bar','itens',
          jsonb_build_array('Caipirinha','Gin tônica','Mojito','Aperol')),
        jsonb_build_object('categoria','Sem álcool','estacao','bar','itens',
          jsonb_build_array('Refrigerante','Suco','Água com gás'))
      ),
      'cafeteria', jsonb_build_array(
        jsonb_build_object('categoria','Cafés','estacao','bar','itens',
          jsonb_build_array('Espresso','Cappuccino','Latte','Coado','Mocha')),
        jsonb_build_object('categoria','Salgados','estacao','cozinha','itens',
          jsonb_build_array('Pão de queijo','Croissant','Misto quente','Quiche')),
        jsonb_build_object('categoria','Doces','estacao','cozinha','itens',
          jsonb_build_array('Bolo de cenoura','Cheesecake','Cookie','Torta de limão')),
        jsonb_build_object('categoria','Geladas','estacao','bar','itens',
          jsonb_build_array('Frappê','Suco natural','Água','Chá gelado'))
      )
    ) -> lower(trim(coalesce(p_tipo, '')))),
    -- Tipo desconhecido: estrutura mínima que serve para qualquer casa, em vez
    -- de devolver nada e deixar o cardápio vazio.
    jsonb_build_array(
      jsonb_build_object('categoria','Pratos','estacao','cozinha','itens',
        jsonb_build_array('Prato do dia')),
      jsonb_build_object('categoria','Bebidas','estacao','bar','itens',
        jsonb_build_array('Refrigerante','Suco','Água'))
    )
  );
$$;

comment on function app.catalogo_por_cozinha(text) is
  'Categorias e nomes de prato típicos do tipo de cozinha. Ponto de partida '
  'para editar — nunca o cardápio final, e NUNCA com preço.';

-- =============================================================================
-- APLICAR O BRIEFING
-- =============================================================================

/**
 * Gera cardápio e mesas a partir das respostas.
 *
 * Idempotente por construção: só cria categoria que ainda não existe pelo nome.
 * Rodar duas vezes não duplica — e alguém VAI rodar duas vezes, porque a
 * primeira falhou a conexão ou porque voltou no botão do navegador.
 *
 * SQLSTATEs:
 *   45090 sem permissão
 */
create or replace function public.aplicar_briefing(p_respostas jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_tipo text := p_respostas ->> 'tipo_cozinha';
  v_mesas int := least(greatest(coalesce((p_respostas ->> 'mesas')::int, 10), 1), 200);
  v_fuso text := coalesce(nullif(p_respostas ->> 'timezone', ''), 'America/Sao_Paulo');
  v_taxa numeric := coalesce((p_respostas ->> 'taxa_servico')::numeric, 10);
  v_bloco jsonb;
  v_categoria uuid;
  v_item text;
  v_ordem int := 0;
  v_criadas int := 0;
  v_produtos int := 0;
begin
  if not app.has_any_role('owner') then
    raise exception 'Só quem administra o restaurante responde o briefing'
      using errcode = '45090';
  end if;

  update public.restaurants
     set timezone = v_fuso,
         service_fee_pct = least(greatest(v_taxa, 0), 30),
         require_phone = coalesce((p_respostas ->> 'pedir_telefone')::boolean, false),
         briefing_at = coalesce(briefing_at, now())
   where id = v_restaurante;

  -- Mesas: só completa o que faltar. Quem já criou 8 no onboarding e responde
  -- "10" aqui recebe mais 2, não mais 10.
  select greatest(0, v_mesas - count(*)) into v_criadas
    from public.restaurant_tables where restaurant_id = v_restaurante;

  if v_criadas > 0 then
    perform public.create_tables(v_criadas, 'Salão');
  end if;

  for v_bloco in select * from jsonb_array_elements(app.catalogo_por_cozinha(v_tipo))
  loop
    v_ordem := v_ordem + 1;

    select id into v_categoria
      from public.categories
     where restaurant_id = v_restaurante and name = (v_bloco ->> 'categoria');

    if not found then
      insert into public.categories (restaurant_id, name, sort_order, station)
      values (v_restaurante, v_bloco ->> 'categoria', v_ordem,
              (v_bloco ->> 'estacao')::public.station)
      returning id into v_categoria;
    end if;

    for v_item in select * from jsonb_array_elements_text(v_bloco -> 'itens')
    loop
      if not exists (
        select 1 from public.products
         where restaurant_id = v_restaurante and name = v_item
      ) then
        -- price_cents = 0 e is_available = false. Ver o cabeçalho: o sistema
        -- não sabe quanto esta casa cobra, e item a R$ 0,00 no cardápio do
        -- cliente é pior que item ausente.
        insert into public.products
          (restaurant_id, category_id, name, price_cents, is_available)
        values (v_restaurante, v_categoria, v_item, 0, false);
        v_produtos := v_produtos + 1;
      end if;
    end loop;
  end loop;

  insert into public.restaurant_briefing (restaurant_id, respostas)
  values (v_restaurante, p_respostas)
  on conflict (restaurant_id) do update
    set respostas = excluded.respostas,
        expires_at = now() + interval '3 hours';

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after
  ) values (
    v_restaurante, 'staff', auth.uid(), 'restaurant.briefing', 'restaurants',
    v_restaurante,
    jsonb_build_object('tipo_cozinha', v_tipo, 'mesas', v_mesas,
                       'produtos_criados', v_produtos)
  );

  return jsonb_build_object(
    'mesas_criadas', v_criadas,
    'produtos_criados', v_produtos
  );
end;
$$;

revoke all on function public.aplicar_briefing(jsonb) from public, anon;
grant execute on function public.aplicar_briefing(jsonb) to authenticated;

-- =============================================================================
-- LIMPEZA DA DEMONSTRAÇÃO
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A ÚNICA fresta na imutabilidade do audit_log, e por que ela é aceitável.
--
-- A limpeza esbarrava em duas paredes ao mesmo tempo: `audit_log` tem trigger
-- que barra DELETE, e a FK dele para `restaurants` é `on delete restrict`. Ou
-- seja, a demonstração não tinha como se apagar — e a exceção subia de dentro
-- de `gerar_demonstracao`, quebrando a geração do PRÓXIMO visitante. O recurso
-- inteiro morria três horas depois de entrar no ar, para todo mundo.
--
-- O que a imutabilidade protege é rastro de gente: ninguém pode apagar a prova
-- de que mexeu num preço, nem o dono. Isso continua intocado. A fresta cobre um
-- caso só, e checado dentro do banco, não confiando em quem chama:
--
--   * é DELETE (UPDATE segue proibido, sem condição nenhuma);
--   * a linha pertence a um restaurante com `expires_at` preenchido — quer
--     dizer, uma demonstração, nunca uma casa de verdade;
--   * e esse prazo JÁ VENCEU. Demo dentro do prazo é tão imutável quanto o
--     resto.
--
-- Um restaurante de verdade tem `expires_at` nulo e nunca satisfaz a condição.
-- Não existe caminho de aplicação que preencha essa coluna: só
-- `gerar_demonstracao` escreve nela.
-- -----------------------------------------------------------------------------
create or replace function app.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and exists (
    select 1 from public.restaurants r
     where r.id = old.restaurant_id
       and r.expires_at is not null
       and r.expires_at < now()
  ) then
    return old;
  end if;

  raise exception 'audit_log é append-only: % não é permitido', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

/**
 * Apaga as demonstrações vencidas.
 *
 * Oportunista, sem cron: roda ao criar a próxima demo. `pg_cron` existiria, mas
 * uma dependência a mais para uma tarefa que sempre tem quem a dispare — todo
 * visitante novo — é complexidade sem retorno.
 *
 * `on delete cascade` não existe em `restaurants` de propósito (`on delete
 * restrict`): apagar restaurante por acidente levaria comanda e pagamento
 * junto. Então a ordem é explícita, das folhas para a raiz.
 */
create or replace function app.limpar_demos_vencidas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_qtd int;
begin
  -- As RESPOSTAS vencem em 3 horas mesmo em restaurante de verdade: elas já
  -- viraram categoria, produto e mesa, e guardar cidade e porte da casa depois
  -- disso é acumular dado de alguém sem uso. `briefing_at` fica; a resposta sai.
  delete from public.restaurant_briefing where expires_at < now();

  select array_agg(id) into v_ids
    from public.restaurants
   where expires_at is not null and expires_at < now();

  if v_ids is null then return 0; end if;
  v_qtd := array_length(v_ids, 1);

  delete from public.order_item_modifiers where restaurant_id = any(v_ids);
  delete from public.order_items          where restaurant_id = any(v_ids);
  delete from public.orders               where restaurant_id = any(v_ids);
  delete from public.payments             where restaurant_id = any(v_ids);
  delete from public.session_adjustments  where restaurant_id = any(v_ids);
  delete from public.waiter_calls         where restaurant_id = any(v_ids);
  delete from public.session_guests       where restaurant_id = any(v_ids);
  delete from public.table_sessions       where restaurant_id = any(v_ids);
  delete from public.menu_blocks          where restaurant_id = any(v_ids);
  delete from public.menu_layouts         where restaurant_id = any(v_ids);
  delete from public.menu_events          where restaurant_id = any(v_ids);
  delete from public.promotion_targets    where restaurant_id = any(v_ids);
  delete from public.promotions           where restaurant_id = any(v_ids);
  delete from public.product_modifier_groups where restaurant_id = any(v_ids);
  delete from public.modifier_options     where restaurant_id = any(v_ids);
  delete from public.modifier_groups      where restaurant_id = any(v_ids);
  delete from public.products             where restaurant_id = any(v_ids);
  delete from public.categories           where restaurant_id = any(v_ids);
  delete from public.restaurant_tables    where restaurant_id = any(v_ids);
  delete from public.restaurant_briefing  where restaurant_id = any(v_ids);
  delete from public.audit_log            where restaurant_id = any(v_ids);

  -- Os perfis e as contas de auth saem junto — e é preciso ser exato sobre o
  -- que isto significa: a conta apagada é a que a PESSOA criou, com o e-mail
  -- dela. Quem gera a demonstração gera em cima da própria conta; não existe
  -- usuário `@demo.markello` nenhum.
  --
  -- Apagar é a escolha certa mesmo assim. Deixar a conta viva com o restaurante
  -- morto dá login que entra num sistema sem perfil, sem mesa e sem cardápio —
  -- e o wizard de onboarding recomeçaria do meio. Some inteiro, e a pessoa se
  -- cadastra de novo em quinze segundos.
  --
  -- Por isso a tela do briefing avisa, com todas as letras, ANTES de gerar.
  delete from auth.users where id in (
    select id from public.profiles where restaurant_id = any(v_ids)
  );
  delete from public.profiles where restaurant_id = any(v_ids);

  delete from public.restaurants where id = any(v_ids);

  return v_qtd;
end;
$$;

revoke all on function app.limpar_demos_vencidas() from public, anon, authenticated;
grant execute on function app.limpar_demos_vencidas() to service_role;
