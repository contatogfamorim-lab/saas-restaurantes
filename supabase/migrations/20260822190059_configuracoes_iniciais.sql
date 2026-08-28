-- =============================================================================
-- 0059 — Configurações iniciais: o restaurante de verdade nasce VAZIO
-- =============================================================================
-- O briefing da 0034 gerava um cardápio a partir do tipo de cozinha: escolhia
-- "hamburgueria" e ganhava Smash Clássico, Cheddar Bacon, Onion Rings. Nasceu
-- com boa intenção — tela vazia é ruim de encarar — e estava errado.
--
-- POR QUE ESTAVA ERRADO
--
-- O sistema não conhece o cardápio daquela casa. Ele conhece o cardápio que uma
-- hamburgueria genérica costuma ter, que é outra coisa. O dono abria o editor e
-- encontrava dez pratos que não vende, todos a R$ 0,00 e fora do ar, e o
-- primeiro trabalho dele com o produto era APAGAR.
--
-- Pior: dava a impressão de que o sistema sabe algo sobre o negócio dele. Não
-- sabe. A regra que o resto do projeto respeita — preço não se inventa, o
-- servidor não sabe o que o dono sabe — parava justamente na porta de entrada.
--
-- ENTÃO: TUDO QUE VEM PRONTO É DEMONSTRAÇÃO
--
-- Restaurante de verdade começa com mesas, fuso e taxa — o que ELE respondeu —
-- e um cardápio em branco. Quem quer ver o sistema cheio pede uma demonstração,
-- que vem completa, em operação, e some em três horas.
--
-- São CINCO demonstrações, uma por tipo de casa, e a escolha é o primeiro passo
-- de quem entra para conhecer: pizzaria, hamburgueria, oriental, açaiteria e
-- balada. Cinco porque são cinco negócios diferentes — uma balada não tem
-- entrada, tem lista; uma açaiteria vende por peso; uma pizzaria vende pela
-- metade. Um "cardápio genérico" não representa nenhum deles.
--
-- E O QUE VEM DE FÁBRICA CONTINUA VINDO
--
-- Selos e restrições alimentares nascem com o restaurante desde a 0043 e a
-- 0048, e continuam nascendo: aquilo não é o cardápio da casa, é vocabulário
-- do sistema — "vegano", "sem glúten", "mais pedido". Não muda de restaurante
-- para restaurante, e inventá-lo não é dizer nada sobre o negócio de ninguém.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Os cinco tipos, e o que cada um é.
--
-- Vive no banco e não no TypeScript porque quem gera a demonstração é o banco:
-- a geração inteira precisa caber numa transação, senão metade de um cardápio
-- fica criada e ninguém sabe o que faltou (lição da 0034).
-- -----------------------------------------------------------------------------
create or replace function app.tipos_de_demonstracao()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('valor','hamburgueria','rotulo','Hamburgueria',
      'descricao','Lanches na chapa, porções e milk-shake'),
    jsonb_build_object('valor','pizzaria','rotulo','Pizzaria',
      'descricao','Pizzas inteiras e meio a meio, doces e salgadas'),
    jsonb_build_object('valor','oriental','rotulo','Oriental',
      'descricao','Sushi, temaki, hot rolls e combinados'),
    jsonb_build_object('valor','acaiteria','rotulo','Açaiteria',
      'descricao','Açaí por tamanho, cremes e adicionais'),
    jsonb_build_object('valor','balada','rotulo','Balada / Bar',
      'descricao','Drinks, garrafas, combos e petiscos')
  );
$$;

grant execute on function app.tipos_de_demonstracao() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- O cardápio de cada demonstração.
--
-- Agora COM PREÇO, ao contrário da 0034 — e é a diferença que importa: aqui o
-- preço é ficção declarada, num restaurante que some em três horas. Lá era
-- palpite sobre o negócio de alguém.
-- -----------------------------------------------------------------------------
create or replace function app.cardapio_da_demonstracao(p_tipo text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (jsonb_build_object(
      'hamburgueria', jsonb_build_array(
        jsonb_build_object('categoria','Burgers','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Smash Clássico', 3200), jsonb_build_array('Smash Duplo', 4200),
          jsonb_build_array('Cheddar Bacon', 4600), jsonb_build_array('Frango Crocante', 3600),
          jsonb_build_array('Veggie de Grão-de-Bico', 3900))),
        jsonb_build_object('categoria','Porções','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Batata frita', 2200), jsonb_build_array('Batata com cheddar e bacon', 3200),
          jsonb_build_array('Onion rings', 2600), jsonb_build_array('Frango a passarinho', 3800))),
        jsonb_build_object('categoria','Bebidas','estacao','bar','itens', jsonb_build_array(
          jsonb_build_array('Refrigerante lata', 800), jsonb_build_array('Suco natural', 1200),
          jsonb_build_array('Água', 600), jsonb_build_array('Cerveja long neck', 1400),
          jsonb_build_array('Milk-shake', 2400))),
        jsonb_build_object('categoria','Sobremesas','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Brownie com sorvete', 2200), jsonb_build_array('Petit gateau', 2400)))
      ),
      'pizzaria', jsonb_build_array(
        jsonb_build_object('categoria','Pizzas salgadas','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Margherita', 5800), jsonb_build_array('Calabresa', 5600),
          jsonb_build_array('Portuguesa', 6400), jsonb_build_array('Quatro queijos', 6800),
          jsonb_build_array('Frango com catupiry', 6200), jsonb_build_array('Pepperoni', 7200))),
        jsonb_build_object('categoria','Pizzas doces','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Chocolate com morango', 5400), jsonb_build_array('Romeu e Julieta', 4800),
          jsonb_build_array('Banana com canela', 4600))),
        jsonb_build_object('categoria','Entradas','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Pão de alho', 1800), jsonb_build_array('Bruschetta', 2400))),
        jsonb_build_object('categoria','Bebidas','estacao','bar','itens', jsonb_build_array(
          jsonb_build_array('Refrigerante 2 L', 1400), jsonb_build_array('Suco de laranja', 1200),
          jsonb_build_array('Cerveja 600 ml', 1600), jsonb_build_array('Vinho tinto taça', 2200)))
      ),
      'oriental', jsonb_build_array(
        jsonb_build_object('categoria','Combinados','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Combinado 20 peças', 7900), jsonb_build_array('Combinado 40 peças', 14900),
          jsonb_build_array('Combinado vegetariano', 6900))),
        jsonb_build_object('categoria','Sushi e sashimi','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Niguiri salmão (2 un)', 1800), jsonb_build_array('Sashimi salmão (5 fatias)', 3200),
          jsonb_build_array('Uramaki Filadélfia (8 un)', 3600), jsonb_build_array('Hot roll (8 un)', 3400))),
        jsonb_build_object('categoria','Temaki','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Temaki salmão', 3200), jsonb_build_array('Temaki skin', 2800),
          jsonb_build_array('Temaki camarão', 3800))),
        jsonb_build_object('categoria','Bebidas','estacao','bar','itens', jsonb_build_array(
          jsonb_build_array('Chá verde gelado', 1000), jsonb_build_array('Sakerinha', 2400),
          jsonb_build_array('Refrigerante lata', 800)))
      ),
      'acaiteria', jsonb_build_array(
        jsonb_build_object('categoria','Açaí','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Açaí 300 ml', 1800), jsonb_build_array('Açaí 500 ml', 2400),
          jsonb_build_array('Açaí 700 ml', 3000), jsonb_build_array('Açaí no pote 1 L', 4200))),
        jsonb_build_object('categoria','Cremes','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Creme de cupuaçu 500 ml', 2600), jsonb_build_array('Creme de ninho 500 ml', 2600),
          jsonb_build_array('Sorvete de açaí (bola)', 900))),
        jsonb_build_object('categoria','Adicionais','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Granola', 400), jsonb_build_array('Leite condensado', 400),
          jsonb_build_array('Morango', 600), jsonb_build_array('Paçoca', 400),
          jsonb_build_array('Nutella', 900))),
        jsonb_build_object('categoria','Bebidas','estacao','bar','itens', jsonb_build_array(
          jsonb_build_array('Água de coco', 900), jsonb_build_array('Vitamina de banana', 1400)))
      ),
      'balada', jsonb_build_array(
        jsonb_build_object('categoria','Drinks','estacao','bar','itens', jsonb_build_array(
          jsonb_build_array('Caipirinha', 2400), jsonb_build_array('Gin tônica', 2800),
          jsonb_build_array('Moscow Mule', 3200), jsonb_build_array('Aperol Spritz', 3400),
          jsonb_build_array('Caipiroska de frutas', 2600))),
        jsonb_build_object('categoria','Garrafas','estacao','bar','itens', jsonb_build_array(
          jsonb_build_array('Vodka nacional', 18000), jsonb_build_array('Whisky 12 anos', 42000),
          jsonb_build_array('Gin importado', 26000), jsonb_build_array('Espumante', 14000))),
        jsonb_build_object('categoria','Cerveja','estacao','bar','itens', jsonb_build_array(
          jsonb_build_array('Long neck', 1400), jsonb_build_array('Balde com 6', 7500),
          jsonb_build_array('Chope 500 ml', 1600))),
        jsonb_build_object('categoria','Para dividir','estacao','cozinha','itens', jsonb_build_array(
          jsonb_build_array('Batata rústica', 3200), jsonb_build_array('Isca de frango', 4200),
          jsonb_build_array('Tábua de frios', 6800)))
      )
    ) -> p_tipo),
    -- Tipo desconhecido devolve vazio em vez de erro: a demonstração nasce com
    -- cardápio em branco, que é feio mas honesto — melhor que travar a criação.
    '[]'::jsonb
  );
$$;

grant execute on function app.cardapio_da_demonstracao(text) to anon, authenticated, service_role;

-- =============================================================================
-- AS CONFIGURAÇÕES INICIAIS DO RESTAURANTE DE VERDADE
-- =============================================================================
-- O que ela faz: grava o que a pessoa RESPONDEU, e cria as mesas.
-- O que ela NÃO faz mais: inventar cardápio.
-- =============================================================================
create or replace function public.aplicar_configuracoes_iniciais(p_respostas jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_mesas int := least(greatest(coalesce((p_respostas ->> 'mesas')::int, 10), 1), 200);
  v_fuso text := coalesce(nullif(p_respostas ->> 'timezone', ''), 'America/Sao_Paulo');
  v_taxa numeric := coalesce((p_respostas ->> 'taxa_servico')::numeric, 10);
  v_cashback numeric := (p_respostas ->> 'cashback')::numeric;
  v_criadas int := 0;
begin
  if not app.has_any_role('owner') then
    raise exception 'Só quem administra o restaurante faz as configurações iniciais'
      using errcode = '45090';
  end if;

  update public.restaurants
     set timezone = v_fuso,
         service_fee_pct = least(greatest(v_taxa, 0), 30),
         require_phone = coalesce((p_respostas ->> 'pedir_telefone')::boolean, false),
         briefing_at = coalesce(briefing_at, now()),
         cashback_pct = case
           when v_cashback is null then cashback_pct
           else least(greatest(v_cashback, 0), 20)
         end
   where id = v_restaurante;

  select greatest(0, v_mesas - count(*)) into v_criadas
    from public.restaurant_tables where restaurant_id = v_restaurante;

  if v_criadas > 0 then
    perform public.create_tables(v_criadas, 'Salão');
  end if;

  -- E ACABOU. Sem categoria, sem produto, sem preço.
  --
  -- A ausência é o conteúdo desta função: ver o cabeçalho da 0059 sobre por que
  -- o cardápio inventado saiu.

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'staff', auth.uid(), 'restaurant.setup', 'restaurant', v_restaurante,
     jsonb_build_object('mesas', v_mesas, 'timezone', v_fuso));

  return jsonb_build_object('mesas_criadas', v_criadas);
end;
$$;

grant execute on function public.aplicar_configuracoes_iniciais(jsonb) to authenticated;

-- A função antiga sai de cena. Deixá-la viva manteria um caminho que ainda
-- inventa cardápio — e seria o caminho que a tela velha continua chamando.
drop function if exists public.aplicar_briefing(jsonb);
drop function if exists app.catalogo_por_cozinha(text);

-- =============================================================================
-- O PAINEL: O QUE JÁ ESTÁ FEITO E O QUE FALTA
-- =============================================================================
-- Deixa de ser um questionário que se responde uma vez e vira um lugar em que
-- se volta. O motivo é o que acontece de fato: ninguém configura um restaurante
-- inteiro numa sentada. A pessoa cria a conta, põe quatro pratos, atende a
-- noite, e volta no dia seguinte — e precisa saber onde parou.
--
-- Cada linha é uma pergunta com resposta verificável no banco. Nada de "você já
-- fez isto?" com caixinha para marcar: caixinha manual mente no primeiro
-- esquecimento.
-- =============================================================================
create or replace function public.progresso_da_configuracao()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r uuid := app.current_restaurant_id();
  v_casa record;
begin
  if v_r is null then
    return '[]'::jsonb;
  end if;

  select r.*,
         (select count(*) from public.restaurant_tables t
           where t.restaurant_id = r.id and t.active)                      as mesas,
         (select count(*) from public.products p
           where p.restaurant_id = r.id and p.archived_at is null)         as produtos,
         (select count(*) from public.products p
           where p.restaurant_id = r.id and p.archived_at is null
             and p.price_cents > 0)                                       as com_preco,
         (select count(*) from public.profiles pr
           where pr.restaurant_id = r.id and pr.active)                    as equipe,
         (select count(*) from public.ingredients i
           where i.restaurant_id = r.id)                                   as insumos,
         (select count(*) from public.product_ingredients pi
           where pi.restaurant_id = r.id)                                  as fichas,
         (select count(*) from public.message_triggers mt
           where mt.restaurant_id = r.id and mt.ativo)                     as gatilhos
    into v_casa
    from public.restaurants r where r.id = v_r;

  return jsonb_build_array(
    jsonb_build_object(
      'chave','mesas', 'titulo','Mesas do salão',
      'feito', v_casa.mesas > 0,
      'detalhe', v_casa.mesas || ' mesas com QR próprio',
      'onde','/app/gestao/mesas',
      'essencial', true,
      'porque','Sem mesa não há QR, e sem QR o cliente não tem por onde pedir.'),

    jsonb_build_object(
      'chave','cardapio', 'titulo','Itens no cardápio',
      'feito', v_casa.produtos > 0,
      'detalhe', v_casa.produtos || ' itens cadastrados',
      'onde','/app/cardapio',
      'essencial', true,
      'porque','O sistema não inventa o seu cardápio: ele não sabe o que você vende.'),

    jsonb_build_object(
      'chave','precos', 'titulo','Preços',
      -- "Todos os itens têm preço", e não "algum tem": item a R$ 0,00 fica
      -- fora do ar, e o dono descobre pela mesa vazia.
      'feito', v_casa.produtos > 0 and v_casa.com_preco = v_casa.produtos,
      'detalhe', case when v_casa.produtos = 0 then 'nenhum item ainda'
                      when v_casa.com_preco = v_casa.produtos then 'todos com preço'
                      else (v_casa.produtos - v_casa.com_preco) || ' sem preço, e por isso fora do ar'
                 end,
      'onde','/app/cardapio',
      'essencial', true,
      'porque','Item sem preço não aparece para o cliente — mostrar R$ 0,00 seria pior.'),

    jsonb_build_object(
      'chave','equipe', 'titulo','Equipe',
      'feito', v_casa.equipe > 1,
      'detalhe', v_casa.equipe || case when v_casa.equipe = 1 then ' pessoa (só você)' else ' pessoas' end,
      'onde','/app/gestao/equipe',
      'essencial', false,
      'porque','Cada um vê a tela do trabalho dele, e o histórico registra quem fez o quê.'),

    jsonb_build_object(
      'chave','cashback', 'titulo','Cashback',
      'feito', v_casa.cashback_pct > 0,
      'detalhe', case when v_casa.cashback_pct > 0
                      then v_casa.cashback_pct || '% de volta, libera em ' ||
                           v_casa.cashback_carencia_horas || 'h'
                      else 'desligado' end,
      'onde','/app/gestao/configuracoes',
      'essencial', false,
      'porque','É o que faz o cliente criar conta — e conta é o que permite avisá-lo depois.'),

    jsonb_build_object(
      'chave','estoque', 'titulo','Estoque e ficha técnica',
      'feito', v_casa.fichas > 0,
      'detalhe', case when v_casa.insumos = 0 then 'nenhum insumo cadastrado'
                      else v_casa.insumos || ' insumos, ' || v_casa.fichas || ' itens em fichas'
                 end,
      'onde','/app/gestao/estoque',
      'essencial', false,
      'porque','Com ficha técnica o estoque baixa sozinho e o prato sai do ar quando acaba.'),

    jsonb_build_object(
      'chave','whatsapp', 'titulo','WhatsApp',
      'feito', v_casa.evolution_instance_name is not null,
      'detalhe', coalesce(v_casa.evolution_instance_name, 'não conectado'),
      'onde','/app/gestao/configuracoes',
      'essencial', false,
      'porque','Sem ele nenhuma campanha sai, nem os avisos automáticos.'),

    jsonb_build_object(
      'chave','avisos', 'titulo','Avisos automáticos',
      'feito', v_casa.gatilhos > 0,
      'detalhe', case when v_casa.gatilhos = 0 then 'nenhum ligado'
                      else v_casa.gatilhos || ' ligados' end,
      'onde','/app/gestao/campanhas',
      'essencial', false,
      'porque','Avisar que o cashback liberou traz gente de volta sem custar desconto.')
  );
end;
$$;

grant execute on function public.progresso_da_configuracao() to authenticated;
