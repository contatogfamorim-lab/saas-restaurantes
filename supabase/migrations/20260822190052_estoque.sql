-- =============================================================================
-- 0052 — Estoque e ficha técnica
-- =============================================================================
-- QUANTIDADE É COMO DINHEIRO: INTEIRO, SEMPRE
--
-- O projeto inteiro guarda dinheiro em centavos inteiros porque `0.1 + 0.2` não
-- dá `0.3` em ponto flutuante. Quantidade tem exatamente o mesmo problema, e
-- pior consequência: uma receita de 150 g repetida trezentas vezes numa noite
-- acumula erro, e o erro aparece como "sobrou estoque que não existe".
--
-- Então tudo aqui é `bigint` em MILÉSIMOS da unidade base:
--
--   150 g          → 150000
--   1,5 L (1500ml) → 1500000
--   meio limão     → 500
--
-- Os milésimos existem porque receita de verdade usa fração de unidade: meio
-- limão, um quarto de cebola. Guardar "un" como inteiro puro obrigaria a
-- escrever 0,5 como 0 ou 1, e as duas respostas estão erradas.
--
-- CUSTO POR MIL, E NÃO POR UNIDADE
--
-- Um grama de carne custa 0,045 centavo. Centavo inteiro não expressa isso, e
-- arredondar para 0 zeraria o custo do prato inteiro. Então o custo é gravado
-- por MIL unidades base — por quilo, por litro, por cento de unidades — que
-- também é como o restaurante compra e como a nota fiscal chega.
--
-- A BAIXA ACONTECE NO `queued`, E NÃO BLOQUEIA NADA
--
-- `queued` é quando a cozinha assume o item (ver o comentário da 0016 na função
-- de transição). Antes disso o pedido pode ser recusado; depois disso o
-- ingrediente já saiu da prateleira.
--
-- E a baixa NUNCA impede a transição. Se o estoque não cobre, ele fica
-- NEGATIVO e o sistema registra. Recusar aqui seria o sistema dizendo "não
-- pode" para um garçom que já aprovou, com o cliente sentado esperando — e o
-- prato provavelmente sai assim mesmo, porque a cozinha olha a bancada, não a
-- tela. Estoque negativo é informação verdadeira: "você vendeu mais do que
-- contou". Zero forçado seria mentira.
--
-- O QUE ESTE ARQUIVO FAZ COM O RESTO DO SISTEMA
--
-- Quando o estoque deixa de cobrir mais UMA porção, o produto sai do ar
-- sozinho. É o elo que faltava: hoje alguém precisa perceber e apertar
-- "Zerou". Com ficha técnica, o sistema percebe primeiro.
--
-- Mas só DESLIGA — nunca religa sozinho. Religar automático brigaria com a
-- pessoa que desligou o prato por outro motivo (o molho azedou, a chapa
-- quebrou), e o prato voltaria ao cardápio no meio do serviço sem ninguém ter
-- decidido isso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A unidade base de cada insumo.
--
-- Três, e só três. A tentação é aceitar "caixa", "fardo", "maço" — e aí duas
-- receitas usam a mesma cebola em unidades diferentes e a conta não fecha
-- nunca. Compra em caixa vira entrada convertida no momento de registrar.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'stock_unit') then
    create type public.stock_unit as enum ('g', 'ml', 'un');
  end if;
end $$;

create table if not exists public.ingredients (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,

  name           text not null,
  unit           public.stock_unit not null,

  -- Em MILÉSIMOS da unidade base. Ver o cabeçalho.
  quantidade     bigint not null default 0,
  -- Abaixo disto a tela avisa. Zero = não avisa.
  minimo         bigint not null default 0,

  -- Centavos por MIL unidades base: por quilo, por litro, por cento.
  custo_por_mil_cents int not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  check (length(btrim(name)) between 2 and 80),
  check (minimo >= 0),
  check (custo_por_mil_cents >= 0)
  -- `quantidade` NÃO tem check de não-negativo. É de propósito: ver o cabeçalho.
);

-- Dois insumos com o mesmo nome na mesma casa são o começo de um estoque que
-- ninguém confia — metade das receitas aponta para um, metade para o outro.
create unique index if not exists ingredients_nome_unico_idx
  on public.ingredients (restaurant_id, lower(btrim(name)));

create index if not exists ingredients_abaixo_do_minimo_idx
  on public.ingredients (restaurant_id) where minimo > 0;

-- -----------------------------------------------------------------------------
-- A FICHA TÉCNICA: quanto de cada insumo vai em um prato.
-- -----------------------------------------------------------------------------
create table if not exists public.product_ingredients (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,

  -- SEM `references` de coluna única aqui, de propósito.
  --
  -- A chave COMPOSTA logo abaixo já garante a integridade referencial, e ainda
  -- garante que prato e insumo são da mesma casa. Manter as duas criaria DOIS
  -- caminhos de `product_ingredients` para `ingredients` — e o PostgREST recusa
  -- o join quando há mais de um, com PGRST201: "Could not embed because more
  -- than one relationship was found".
  --
  -- O sintoma não é um erro na tela. É a ficha técnica aparecendo VAZIA, com a
  -- frase "este prato não desconta nada do estoque" — que é uma resposta
  -- plausível, e por isso ninguém desconfiaria.
  product_id     uuid not null,
  ingredient_id  uuid not null,

  -- Milésimos por UMA porção. Item com qty 3 multiplica na hora da baixa.
  quantidade     bigint not null,

  created_at     timestamptz not null default now(),

  check (quantidade > 0)
);

create unique index if not exists product_ingredients_unico_idx
  on public.product_ingredients (product_id, ingredient_id);

-- -----------------------------------------------------------------------------
-- O PRATO E O INSUMO PRECISAM SER DA MESMA CASA.
--
-- Sem isto existe um furo estreito e real. A policy de RLS confere apenas o
-- `restaurant_id` DA LINHA — e a linha é escrita pelo cliente. Alguém com um
-- uuid de produto de outro restaurante poderia gravar uma ficha com o PRÓPRIO
-- `restaurant_id` apontando para o produto ALHEIO.
--
-- O efeito não seria roubo de dado, seria pior de entender: toda vez que a
-- outra casa vendesse aquele prato, o gatilho encontraria esta linha e daria
-- baixa NO ESTOQUE DE QUEM ESCREVEU. Um restaurante veria o estoque cair
-- sozinho, e o extrato apontaria para um pedido que ele não consegue abrir.
--
-- Chave composta é o que fecha isso de forma estrutural: não dá para apontar
-- para um produto de outra casa porque o par (id, restaurant_id) não existe.
-- `on delete cascade` nos dois — apagar o produto ou o insumo leva a ficha
-- junto, que é o comportamento que já estava declarado.
-- -----------------------------------------------------------------------------
create unique index if not exists products_id_restaurante_idx
  on public.products (id, restaurant_id);
create unique index if not exists ingredients_id_restaurante_idx
  on public.ingredients (id, restaurant_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ficha_produto_da_mesma_casa'
  ) then
    alter table public.product_ingredients
      add constraint ficha_produto_da_mesma_casa
      foreign key (product_id, restaurant_id)
      references public.products (id, restaurant_id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ficha_insumo_da_mesma_casa'
  ) then
    alter table public.product_ingredients
      add constraint ficha_insumo_da_mesma_casa
      foreign key (ingredient_id, restaurant_id)
      references public.ingredients (id, restaurant_id) on delete cascade;
  end if;
end $$;

create index if not exists product_ingredients_por_insumo_idx
  on public.product_ingredients (ingredient_id);

-- -----------------------------------------------------------------------------
-- TODO movimento, com motivo.
--
-- A tabela é o extrato: `ingredients.quantidade` é só o saldo, e saldo sem
-- extrato é um número que ninguém consegue explicar. A pergunta que aparece no
-- primeiro mês — "por que sumiram 4 kg de queijo?" — só tem resposta aqui.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'stock_movement_kind') then
    create type public.stock_movement_kind as enum (
      'entrada',    -- compra, recebimento
      'venda',      -- baixa automática pela ficha técnica
      'devolucao',  -- item recusado antes de a cozinha começar
      'perda',      -- quebra, vencimento, queimou
      'ajuste'      -- contagem física: o estoque real venceu o sistema
    );
  end if;
end $$;

create table if not exists public.stock_movements (
  id             uuid primary key default gen_random_uuid(),

  -- A ORDEM DO EXTRATO, e por que `created_at` não serve.
  --
  -- `now()` no Postgres é o instante da TRANSAÇÃO. Uma comanda com três itens
  -- gera três movimentos com o MESMO `created_at`, e ordenar por ele devolve
  -- uma ordem arbitrária — o `id` é um uuid aleatório, então nem serve de
  -- desempate. Um extrato que não sabe dizer o que veio antes não é extrato.
  --
  -- Foi um teste que encontrou isto: ele lia "o saldo da última linha" e
  -- recebia o da linha do meio.
  seq            bigint generated always as identity,
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id) on delete cascade,

  kind           public.stock_movement_kind not null,
  -- Milésimos, COM SINAL. Entrada é positiva, venda e perda são negativas.
  -- Guardar o sinal aqui em vez de deduzir do `kind` deixa o ajuste de
  -- contagem funcionar nos dois sentidos com um registro só.
  delta          bigint not null,

  -- O saldo DEPOIS deste movimento, congelado.
  --
  -- Redundante com a soma dos deltas, e vale a redundância: é o que permite
  -- abrir o extrato e ver o saldo em cada linha sem recalcular a história
  -- inteira — e é o que denuncia um saldo que foi mexido por fora.
  saldo_depois   bigint not null,

  motivo         text,
  actor_id       uuid references public.profiles(id) on delete set null,
  -- Só para baixa automática: liga o movimento ao item que o causou.
  order_item_id  uuid references public.order_items(id) on delete set null,

  created_at     timestamptz not null default now(),

  check (delta <> 0)
);

-- A GUARDA DA IDEMPOTÊNCIA.
--
-- Um item que volta para `queued` — porque alguém corrigiu o status, porque a
-- transição foi disparada duas vezes — não pode baixar o estoque de novo. O
-- índice é o que garante isso: a segunda tentativa esbarra na chave, e a
-- checagem no código nunca resolveria a corrida entre dois garçons.
create unique index if not exists stock_movements_uma_baixa_idx
  on public.stock_movements (order_item_id, ingredient_id, kind)
  where order_item_id is not null;

create index if not exists stock_movements_extrato_idx
  on public.stock_movements (ingredient_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Por que o produto está fora do ar.
--
-- `is_available = false` sozinho não distingue "a casa marcou Zerou" de "o
-- sistema tirou por falta de ingrediente". A diferença importa na tela: no
-- primeiro caso alguém religa quando quiser; no segundo, religar sem repor não
-- resolve nada, e a cozinha vai descobrir na comanda.
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists unavailable_reason text;

comment on column public.products.unavailable_reason is
  'Por que saiu do ar. NULL = a casa marcou à mão. "estoque" = o sistema tirou '
  'por falta de ingrediente.';

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.ingredients         enable row level security;
alter table public.product_ingredients enable row level security;
alter table public.stock_movements     enable row level security;

-- Ler o estoque é da operação inteira: a cozinha precisa saber o que tem.
create policy insumos_leitura on public.ingredients
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

-- Escrever à mão em `ingredients` NÃO é permitido para ninguém.
--
-- O saldo só muda por movimento registrado — é isso que mantém o extrato
-- honesto. Um UPDATE direto na coluna criaria um saldo sem linha que o
-- explique, e a primeira pergunta de auditoria de estoque ("de onde veio esse
-- número?") ficaria sem resposta.
--
-- Criar e renomear insumo é outra coisa, e passa por função.
create policy fichas_leitura on public.product_ingredients
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

create policy fichas_escrita on public.product_ingredients
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'));

create policy movimentos_leitura on public.stock_movements
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

-- Movimento também não se escreve à mão: `registrar_movimento` é quem mexe, e
-- é ela que atualiza o saldo na mesma transação. Um INSERT solto deixaria o
-- extrato e o saldo discordando para sempre.

grant select on public.ingredients         to authenticated;
grant select, insert, update, delete on public.product_ingredients to authenticated;
grant select on public.stock_movements     to authenticated;

grant select, insert, update, delete on public.ingredients     to service_role;
grant select, insert, update, delete on public.stock_movements to service_role;
grant select, insert, update, delete on public.product_ingredients to service_role;

-- =============================================================================
-- O MOVIMENTO
-- =============================================================================
-- Um caminho só para mexer no estoque. Grava o extrato e o saldo na MESMA
-- transação, e devolve o saldo novo.
-- =============================================================================
create or replace function app.registrar_movimento(
  p_insumo   uuid,
  p_kind     public.stock_movement_kind,
  p_delta    bigint,
  p_motivo   text default null,
  p_item     uuid default null,
  p_actor    uuid default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid;
  v_saldo       bigint;
begin
  if p_delta = 0 then
    return null;  -- movimento de zero não é movimento.
  end if;

  -- `for update`: duas comandas do mesmo prato saindo ao mesmo tempo leriam o
  -- mesmo saldo e gravariam o mesmo `saldo_depois`, e o extrato passaria a
  -- mentir. A trava serializa as duas.
  select i.restaurant_id, i.quantidade into v_restaurante, v_saldo
    from public.ingredients i
   where i.id = p_insumo
   for update;

  if v_restaurante is null then
    raise exception 'Insumo não encontrado' using errcode = '45130';
  end if;

  v_saldo := v_saldo + p_delta;

  update public.ingredients
     set quantidade = v_saldo, updated_at = now()
   where id = p_insumo;

  insert into public.stock_movements
    (restaurant_id, ingredient_id, kind, delta, saldo_depois, motivo, actor_id, order_item_id)
  values
    (v_restaurante, p_insumo, p_kind, p_delta, v_saldo, p_motivo, p_actor, p_item);

  return v_saldo;
end;
$$;

revoke all on function app.registrar_movimento(uuid, public.stock_movement_kind, bigint, text, uuid, uuid)
  from public, anon, authenticated;

-- =============================================================================
-- A BAIXA AUTOMÁTICA
-- =============================================================================
create or replace function app.baixar_estoque_do_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ficha record;
  v_saldo bigint;
begin
  -- Só na ENTRADA em `queued`, e só vindo de um estado anterior. `queued` para
  -- `queued` não é evento.
  if not (new.status = 'queued' and old.status is distinct from 'queued') then
    return new;
  end if;

  for v_ficha in
    select pi.ingredient_id, pi.quantidade
      from public.product_ingredients pi
     where pi.product_id = new.product_id
  loop
    begin
      v_saldo := app.registrar_movimento(
        v_ficha.ingredient_id,
        'venda',
        -(v_ficha.quantidade * new.qty),
        null,
        new.id,
        null
      );
    exception
      when unique_violation then
        -- Já foi baixado por este item. O índice é o guarda; chegar aqui é o
        -- caso normal de uma transição repetida, não um erro.
        continue;
    end;

    -- O prato sai do ar quando o que sobrou não faz mais UMA porção.
    --
    -- Não é "quando zerar": zerar tarde demais deixa o próximo cliente pedir
    -- um prato que não existe. A conta é "sobra menos que a receita pede".
    if v_saldo < v_ficha.quantidade then
      update public.products p
         set is_available = false,
             unavailable_reason = 'estoque',
             updated_at = now()
        from public.product_ingredients pi
       where pi.ingredient_id = v_ficha.ingredient_id
         and p.id = pi.product_id
         and p.is_available
         -- Só derruba pratos cuja receita não cabe mais no que sobrou. Um prato
         -- que usa 10 g do mesmo insumo continua de pé enquanto houver 10 g.
         and v_saldo < pi.quantidade;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists baixa_de_estoque on public.order_items;
create trigger baixa_de_estoque
  after update of status on public.order_items
  for each row execute function app.baixar_estoque_do_item();

-- -----------------------------------------------------------------------------
-- A DEVOLUÇÃO, e o limite dela.
--
-- Item que sai de `queued` para recusa volta ao estoque: a cozinha não tinha
-- começado — `queued` é a fila, `preparing` é a chapa.
--
-- De `preparing` em diante NÃO volta, e é a decisão que importa aqui: o
-- ingrediente já virou comida. Devolver ali inflaria o estoque com carne que
-- está na lixeira, e o sistema passaria a informar que existe comida que não
-- existe. Isso é PERDA, e perda se registra à mão — para alguém ter que olhar
-- o número.
-- -----------------------------------------------------------------------------
create or replace function app.devolver_estoque_do_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mov record;
begin
  if not (new.status in ('cancelled', 'out_of_stock') and old.status = 'queued') then
    return new;
  end if;

  for v_mov in
    select m.ingredient_id, m.delta
      from public.stock_movements m
     where m.order_item_id = new.id and m.kind = 'venda'
  loop
    begin
      perform app.registrar_movimento(
        v_mov.ingredient_id,
        'devolucao',
        -v_mov.delta,          -- a venda é negativa; devolver é somar de volta
        -- `::text` explícito: `rejection_reason` é um ENUM, e sem o cast o
        -- Postgres tenta converter 'item recusado' PARA o enum — que não tem
        -- esse valor — em vez de converter o enum para texto.
        coalesce(new.rejection_reason::text, 'item recusado'),
        new.id,
        null
      );
    exception
      when unique_violation then continue;
    end;
  end loop;

  return new;
end;
$$;

drop trigger if exists devolucao_de_estoque on public.order_items;
create trigger devolucao_de_estoque
  after update of status on public.order_items
  for each row execute function app.devolver_estoque_do_item();

-- =============================================================================
-- O QUE A EQUIPE CHAMA
-- =============================================================================
create or replace function public.criar_insumo(
  p_nome    text,
  p_unidade public.stock_unit,
  p_minimo  bigint default 0,
  p_custo   int default 0
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_id uuid;
begin
  if not app.has_any_role('owner', 'manager') then
    raise exception 'Só dono ou gerente cadastra insumo' using errcode = '42501';
  end if;

  insert into public.ingredients (restaurant_id, name, unit, minimo, custo_por_mil_cents)
  values (v_restaurante, btrim(p_nome), p_unidade, greatest(coalesce(p_minimo, 0), 0),
          greatest(coalesce(p_custo, 0), 0))
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe um insumo com esse nome' using errcode = '45131';
end;
$$;

create or replace function public.editar_insumo(
  p_insumo  uuid,
  p_nome    text default null,
  p_minimo  bigint default null,
  p_custo   int default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_any_role('owner', 'manager') then
    raise exception 'Só dono ou gerente edita insumo' using errcode = '42501';
  end if;

  -- A UNIDADE não está aqui, e a ausência é a decisão. Trocar g por ml depois
  -- de existirem receitas reinterpretaria silenciosamente toda ficha técnica
  -- que aponta para este insumo. Quem errou a unidade cria outro e refaz.
  update public.ingredients
     set name = coalesce(nullif(btrim(p_nome), ''), name),
         minimo = coalesce(greatest(p_minimo, 0), minimo),
         custo_por_mil_cents = coalesce(greatest(p_custo, 0), custo_por_mil_cents),
         updated_at = now()
   where id = p_insumo
     and restaurant_id = app.current_restaurant_id();

  if not found then
    raise exception 'Insumo não encontrado' using errcode = '45130';
  end if;
  return true;
exception
  when unique_violation then
    raise exception 'Já existe um insumo com esse nome' using errcode = '45131';
end;
$$;

/**
 * Entrada, perda e ajuste — os movimentos que uma pessoa registra.
 *
 * `venda` e `devolucao` não entram aqui: são automáticos, e deixar a equipe
 * registrar uma "venda" à mão criaria baixa sem pedido, que é o buraco por onde
 * o estoque some sem rastro.
 */
create or replace function public.movimentar_estoque(
  p_insumo uuid,
  p_kind   text,
  p_delta  bigint,
  p_motivo text default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_saldo bigint;
begin
  if p_kind not in ('entrada', 'perda', 'ajuste') then
    raise exception 'Movimento inválido: %', p_kind using errcode = '45132';
  end if;

  -- QUEM PODE O QUÊ, e a diferença importa.
  --
  -- PERDA é da cozinha: é ela que vê a comida estragar, e obrigar a chamar o
  -- gerente para registrar meio quilo de alface murcha é obrigar a não
  -- registrar. Perda que ninguém anota é perda que vira "sumiu queijo".
  --
  -- ENTRADA e AJUSTE não são. Entrada é o que a casa comprou — mexe em nota
  -- fiscal e em custo. Ajuste é a contagem física, que é o momento em que o
  -- sistema aceita que estava errado; deixar qualquer um refazer o saldo é
  -- deixar qualquer um apagar uma diferença em vez de explicá-la.
  if p_kind = 'perda' then
    if not app.has_any_role('owner', 'manager', 'kitchen') then
      raise exception 'Sem permissão para registrar perda' using errcode = '42501';
    end if;
  else
    if not app.has_any_role('owner', 'manager') then
      raise exception 'Só dono ou gerente registra entrada e contagem'
        using errcode = '42501';
    end if;
  end if;

  -- Perda é sempre saída, entrada é sempre entrada. Ajuste é o único que anda
  -- nos dois sentidos, porque a contagem física pode achar mais ou menos.
  if p_kind = 'entrada' and p_delta < 0 then
    raise exception 'Entrada não tira do estoque' using errcode = '45133';
  end if;
  if p_kind = 'perda' and p_delta > 0 then
    raise exception 'Perda não põe no estoque' using errcode = '45133';
  end if;

  if not exists (
    select 1 from public.ingredients
     where id = p_insumo and restaurant_id = v_restaurante
  ) then
    raise exception 'Insumo não encontrado' using errcode = '45130';
  end if;

  v_saldo := app.registrar_movimento(
    p_insumo, p_kind::public.stock_movement_kind, p_delta, p_motivo, null, auth.uid()
  );

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'staff', auth.uid(), 'estoque.' || p_kind, 'ingredient', p_insumo,
     jsonb_build_object('delta', p_delta, 'saldo', v_saldo, 'motivo', p_motivo));

  return v_saldo;
end;
$$;

grant execute on function public.criar_insumo(text, public.stock_unit, bigint, int) to authenticated;
grant execute on function public.editar_insumo(uuid, text, bigint, int)             to authenticated;
grant execute on function public.movimentar_estoque(uuid, text, bigint, text)       to authenticated;

-- =============================================================================
-- O QUE AS TELAS LEEM
-- =============================================================================
-- `security_invoker`: atravessa a RLS com o crachá de quem consulta.
-- =============================================================================
create or replace view public.estoque_atual
with (security_invoker = true) as
  select
    i.id,
    i.restaurant_id,
    i.name,
    i.unit,
    i.quantidade,
    i.minimo,
    i.custo_por_mil_cents,
    -- O que a casa tem parado ali, em centavos.
    ((i.quantidade * i.custo_por_mil_cents) / 1000000)::bigint as valor_cents,
    (i.minimo > 0 and i.quantidade < i.minimo)                 as abaixo_do_minimo,
    (i.quantidade < 0)                                         as negativo,
    (select count(*) from public.product_ingredients pi where pi.ingredient_id = i.id)
      as pratos_que_usam
  from public.ingredients i;

grant select on public.estoque_atual to authenticated;

-- -----------------------------------------------------------------------------
-- O CUSTO DO PRATO — o que a ficha técnica existe para responder.
--
-- Sem isto, ficha técnica é só uma lista de ingredientes. Com isto, é a conta
-- que diz se o prato dá lucro: `custo_cents` contra `price_cents`.
--
-- `porcoes_possiveis` responde a outra pergunta, a da noite: quantos ainda dão
-- para fazer com o que tem na câmara. É o mínimo entre os ingredientes, porque
-- é o que acabar primeiro que decide.
-- -----------------------------------------------------------------------------
create or replace view public.custo_dos_pratos
with (security_invoker = true) as
  select
    p.id                as product_id,
    p.restaurant_id,
    p.name,
    p.price_cents,
    coalesce(sum((pi.quantidade * i.custo_por_mil_cents) / 1000000), 0)::bigint as custo_cents,
    count(pi.id)                                                                as itens_na_ficha,
    min(
      case when pi.quantidade > 0 then greatest(i.quantidade, 0) / pi.quantidade end
    )::bigint                                                                   as porcoes_possiveis
  from public.products p
  left join public.product_ingredients pi on pi.product_id = p.id
  left join public.ingredients i on i.id = pi.ingredient_id
  group by p.id;

grant select on public.custo_dos_pratos to authenticated;
