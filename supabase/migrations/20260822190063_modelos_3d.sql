-- =============================================================================
-- 0063 — Modelos 3D dos pratos
-- =============================================================================
-- O cardápio deixa de ser uma lista de fotos e passa a mostrar o prato em três
-- dimensões, girando conforme o cliente rola, com a opção de pousá-lo na mesa
-- em tamanho real pela câmera.
--
-- POR QUE TABELA SEPARADA, E NÃO COLUNAS EM `products`
--
-- Três razões, em ordem de peso:
--
-- 1. A DIGITALIZAÇÃO É ASSÍNCRONA. O dono fotografa o prato e o modelo fica
--    pronto minutos depois, num serviço que roda fora daqui. Isso exige
--    `status`, `erro`, `pedido_em`, `pronto_em` — quatro colunas que só fazem
--    sentido para o modelo e que ficariam nulas em `products` para sempre.
--
-- 2. SÃO TRÊS ARQUIVOS, NÃO UM. O `card` é o que roda na lista, leve. O `hero`
--    é o que abre em tela cheia e alimenta o AR do Android. O `usdz` é o mesmo
--    prato no formato que o iPhone exige — o Quick Look não lê glTF, e não há
--    conversão possível no navegador.
--
-- 3. OS GATILHOS DE `products` JÁ CONTAM COLUNA POR COLUNA. A 0030 registra na
--    auditoria "trocou a foto" comparando `new.image_url is distinct from
--    old.image_url`, e a 0013 decide o que é mudança de conteúdo pela mesma
--    lista. Somar cinco colunas ali obrigaria a revisar cada gatilho, e
--    esquecer um significa mudança de cardápio que não aparece no log.
--
-- O QUE O BANCO GUARDA É CAMINHO, NUNCA URL
--
-- Mesma decisão da 0015 para as fotos: `{restaurant_id}/{product_id}-card.glb`.
-- A URL pública é montada na leitura. É o que permite trocar de projeto
-- Supabase — local, staging, produção — sem reescrever linha por linha.
--
-- TAMANHO REAL É DADO, NÃO É PROPRIEDADE DO ARQUIVO
--
-- `largura_cm` existe porque o AR promete o tamanho verdadeiro do prato, e essa
-- promessa vale o que valer esse número. glTF é definido em metros e o USDZ tem
-- o próprio `metersPerUnit`: se os dois divergirem, o mesmo prato sai de
-- tamanhos diferentes no Android e no iPhone, e ninguém descobre sem dois
-- aparelhos na mão. Guardar a medida aqui permite conferir na exportação e
-- recusar o que estiver fora da faixa plausível.
--
-- Ninguém mede prato, então a interface não pergunta em centímetros: pergunta
-- em qual louça o prato é servido — raso de 26, sobremesa de 20, tigela de 16 —
-- e deriva o número disto.
-- =============================================================================

create type public.status_do_modelo as enum (
  'pendente',      -- fotos enviadas, esperando a vez na fila
  'processando',   -- digitalização em curso
  'pronto',        -- os arquivos existem e podem ser servidos
  'falhou'         -- deu errado; `erro` explica, e o cardápio cai para a foto
);

create table public.product_models (
  -- O produto é a chave: um prato tem no máximo um modelo. Versão anterior de
  -- modelo não é histórico que alguém consulte — é arquivo que se substitui.
  product_id     uuid primary key references public.products(id) on delete cascade,
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,

  status         public.status_do_modelo not null default 'pendente',

  -- Caminhos no bucket `product-models`. Nulos enquanto o status não é 'pronto'.
  card_path      text check (length(card_path) <= 400),
  hero_path      text check (length(hero_path) <= 400),
  usdz_path      text check (length(usdz_path) <= 400),

  -- Bytes de cada arquivo. Guardados porque egress é medido no nosso plano e
  -- porque o dono precisa ver o que o cardápio dele está pesando — número que
  -- ninguém consegue estimar de cabeça.
  card_bytes     int check (card_bytes >= 0),
  hero_bytes     int check (hero_bytes >= 0),
  usdz_bytes     int check (usdz_bytes >= 0),

  -- A maior dimensão horizontal do prato montado, em centímetros. Entre um
  -- copo de cafezinho e uma travessa de família: fora disso é erro de unidade,
  -- que é o defeito silencioso clássico do AR.
  largura_cm     numeric(5,1) check (largura_cm between 4 and 80),

  erro           text check (length(erro) <= 500),
  pedido_em      timestamptz not null default now(),
  pronto_em      timestamptz,

  -- Mesmo FK composto de `products`: impede que o modelo do restaurante A
  -- aponte para um produto do restaurante B. Isolamento pelo schema, e não por
  -- policy que alguém pode esquecer de escrever.
  foreign key (product_id, restaurant_id)
    references public.products (id, restaurant_id) on delete cascade,

  -- Status 'pronto' sem arquivo é o pior estado possível: o cardápio pensa que
  -- tem modelo, pede uma URL nula e o card fica vazio. Impedido aqui, e não na
  -- aplicação, porque quem escreve nesta tabela é um worker externo.
  constraint modelo_pronto_tem_arquivo
    check (status <> 'pronto' or (card_path is not null and hero_path is not null))
);

comment on table public.product_models is
  'Modelo 3D do prato: o leve do cardápio, o pesado do AR e o USDZ do iPhone. '
  'Uma linha por produto; ausência de linha significa cardápio com foto.';

comment on column public.product_models.largura_cm is
  'Maior dimensão horizontal do prato montado. É o que sustenta a promessa de '
  'tamanho real no AR — conferir contra a bounding box na exportação.';

create index product_models_restaurante_idx
  on public.product_models (restaurant_id, status);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.product_models enable row level security;

-- Leitura pública: o cardápio é público por natureza, e o modelo com ele. Vale
-- a mesma regra da foto — quem abre o QR da mesa não está logado.
create policy "modelos: leitura pública"
  on public.product_models for select
  to anon, authenticated
  using (true);

-- Escrita: equipe do próprio restaurante, com permissão de conteúdo de cardápio.
-- Mesmo par de permissões que governa trocar a foto (0015), porque é a mesma
-- decisão editorial: mudar o que o cliente vê.
create policy "modelos: escrita do próprio restaurante"
  on public.product_models for all
  to authenticated
  using (
    restaurant_id = app.current_restaurant_id()
    and app.has_menu_permission('menu.content')
  )
  with check (
    restaurant_id = app.current_restaurant_id()
    and app.has_menu_permission('menu.content')
  );

-- ── GRANTS ──────────────────────────────────────────────────────────────────
-- Policy sem grant não abre nada (lição da 0043), e a 0013 fecha por padrão:
-- ela revoga tudo de `anon` e ainda deixa `alter default privileges` armado
-- para as tabelas que nem existiam. Toda tabela nova precisa se declarar — e
-- `service_role` também, porque o `grant all` da 0013 alcançou só o presente.
grant select on public.product_models to anon;
grant select, insert, update, delete on public.product_models to authenticated;
grant all on public.product_models to service_role;

-- ── BUCKET ──────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-models',
  'product-models',
  true,
  -- 24 MB de rede de segurança. O que o cardápio serve é MUITO menor — o
  -- modelo leve fica na casa das dezenas de KB e o pesado abaixo de 1 MB, com
  -- Draco e KTX2 — mas quem escreve aqui é um worker de digitalização, e o
  -- limite existe para o dia em que ele subir o arquivo errado.
  25165824,
  array[
    'model/gltf-binary',   -- .glb, Android e o cardápio
    'model/vnd.usdz+zip',  -- .usdz, Quick Look do iPhone
    'model/usd'            -- alguns exportadores rotulam o usdz assim
  ]
)
on conflict (id) do nothing;

create policy "modelos de produto: leitura pública"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-models');

create policy "modelos de produto: escrita do próprio restaurante"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-models'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
    and app.has_menu_permission('menu.content')
  );

create policy "modelos de produto: troca do próprio restaurante"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-models'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
    and app.has_menu_permission('menu.content')
  )
  with check (
    bucket_id = 'product-models'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
    and app.has_menu_permission('menu.content')
  );

create policy "modelos de produto: remoção do próprio restaurante"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-models'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
    and app.has_menu_permission('menu.content')
  );
