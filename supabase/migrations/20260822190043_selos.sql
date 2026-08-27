-- =============================================================================
-- 0043 — Selos: de enum fixo para cadastro da casa
-- =============================================================================
-- O QUE MUDA
--
-- Os selos eram quatro, fixos num enum: `novo`, `mais_pedido`, `picante`,
-- `da_casa`. Uma casa que quisesse "SEM GLÚTEN", "PROMOÇÃO DA SEMANA" ou
-- "FEITO NA HORA" precisava de uma migration. Enum é o lugar errado para
-- decisão de marketing: ele existe para o que o SISTEMA precisa distinguir, não
-- para o que a casa quer anunciar.
--
-- Agora são linhas numa tabela, com cor e animação próprias. Os quatro antigos
-- viram linhas também — ninguém perde nada.
--
-- POR QUE `products.badges` VIRA text[]
--
-- Porque o conjunto deixou de ser fechado. O enum continua existindo (outras
-- coisas o referenciam), mas a coluna passa a guardar SLUG, e o slug é validado
-- contra a tabela por trigger — não por tipo.
--
-- A conversão é segura: os quatro valores atuais viram exatamente as mesmas
-- strings, e a migration cria as linhas correspondentes antes de converter.
-- =============================================================================

create table public.product_badges (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,

  -- Identificador estável, usado em `products.badges`. Minúsculas e underscore:
  -- é chave, não texto de tela.
  slug          text not null check (slug ~ '^[a-z0-9_]{2,32}$'),

  -- O que o cliente lê. Curto de propósito — selo que não cabe no card vira
  -- reticências, e reticências não vendem nada.
  label         text not null check (length(btrim(label)) between 2 and 18),

  -- Hexadecimal, e é a casa que escolhe. Validado aqui porque valor inválido
  -- não quebra o banco: quebra o `style` do card no celular do cliente.
  color         text not null default '#D97A28' check (color ~ '^#[0-9A-Fa-f]{6}$'),

  -- Como o selo chama atenção. `none` é o padrão: tela cheia de coisa piscando
  -- não destaca nada, e a casa que puser animação em tudo não destaca nada.
  animation     text not null default 'none'
                check (animation in ('none', 'pulse', 'shine', 'bounce')),

  sort_order    int not null default 0,
  active        boolean not null default true,

  -- Os quatro originais não podem ser apagados: `built_in` os protege, porque
  -- produtos antigos os referenciam e o cardápio ficaria com selo órfão.
  built_in      boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (restaurant_id, slug)
);

create index product_badges_do_restaurante_idx
  on public.product_badges (restaurant_id, sort_order);

alter table public.product_badges enable row level security;

-- O cliente PRECISA ler: é o que pinta o selo no cardápio. Só os ativos, e só
-- de restaurante ativo — a mesma regra das outras quatro tabelas públicas.
-- `app.restaurant_is_active` e NÃO um `exists` em `restaurants`.
--
-- O `anon` não tem SELECT em `restaurants` — de propósito, desde a 0013: a
-- lista de clientes da plataforma não sai pela chave que vai no bundle. Um
-- subselect ali dentro da policy morre com "permission denied", e o efeito é
-- traiçoeiro: nenhum erro na tela, os selos simplesmente somem do cardápio.
--
-- É a mesma função `security definer` que as outras cinco tabelas públicas já
-- usam. Copiei o padrão errado da primeira vez e vi os selos sumirem do card.
create policy badges_public_read on public.product_badges
  for select to anon
  using (active and app.restaurant_is_active(restaurant_id));

create policy badges_staff_read on public.product_badges
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

-- Criar e editar selo é `menu.content`: é decisão de vitrine, a mesma
-- permissão que muda nome e descrição do prato.
create policy badges_staff_write on public.product_badges
  for all to authenticated
  using (
    restaurant_id = app.current_restaurant_id()
    and app.has_menu_permission('menu.content')
  )
  with check (
    restaurant_id = app.current_restaurant_id()
    and app.has_menu_permission('menu.content')
  );

grant select on public.product_badges to anon;
grant select, insert, update, delete on public.product_badges to authenticated;
grant select on public.product_badges to service_role;

-- -----------------------------------------------------------------------------
-- Os quatro que já existiam viram linhas, para cada restaurante.
--
-- As cores não são decorativas: picante é vermelho porque é aviso, novo é verde
-- porque é convite, e "mais pedido" ganha o laranja da marca porque é prova
-- social — a que mais move a escolha de quem está com fome e indeciso.
-- -----------------------------------------------------------------------------
/**
 * Os quatro selos internos de uma casa.
 *
 * Função, e não um INSERT solto: restaurante criado DEPOIS desta migration
 * também precisa deles. Foi exatamente o que me pegou aqui — o `insert` inicial
 * cobria só quem já existia, e o seed, que insere o Brasa Burger depois de
 * todas as migrations, subia sem selo nenhum. O trigger de validação então
 * recusava cada produto com selo, e a migration morria com "Selo ... não
 * existe". É a mesma lição do `briefing_at` na 0034.
 */
create or replace function app.criar_selos_internos(p_restaurante uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.product_badges
    (restaurant_id, slug, label, color, animation, sort_order, built_in)
  select p_restaurante, b.slug, b.label, b.color, b.animation, b.ord, true
    from (values
      ('mais_pedido', 'MAIS PEDIDO', '#D97A28', 'shine', 1),
      ('novo',        'NOVO',        '#3FA34D', 'pulse', 2),
      ('da_casa',     'DA CASA',     '#8B5CF6', 'none',  3),
      ('picante',     'PICANTE',     '#DC2626', 'none',  4)
    ) as b(slug, label, color, animation, ord)
  on conflict (restaurant_id, slug) do nothing;
$$;

create or replace function app.selos_ao_nascer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.criar_selos_internos(new.id);
  return new;
end;
$$;

create trigger restaurants_ganham_selos
  after insert on public.restaurants
  for each row execute function app.selos_ao_nascer();

-- E os que já existiam.
select app.criar_selos_internos(id) from public.restaurants;

-- -----------------------------------------------------------------------------
-- `products.badges`: de `product_badge[]` para `text[]`.
--
-- O cast é literal — os rótulos do enum são exatamente os slugs criados acima.
-- -----------------------------------------------------------------------------
alter table public.products
  alter column badges type text[] using badges::text[];

/**
 * Todo selo posto num produto tem de existir na casa.
 *
 * Era o tipo que garantia isso; agora é este trigger. Sem ele, `badges` viraria
 * campo de texto livre e o cardápio mostraria selo sem cor, sem rótulo e sem
 * dono — ou não mostraria nada, que é pior porque ninguém percebe.
 */
create or replace function app.selos_existem()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invalido text;
begin
  if new.badges is null or array_length(new.badges, 1) is null then
    return new;
  end if;

  select s into v_invalido
    from unnest(new.badges) as s
   where not exists (
     select 1 from public.product_badges b
      where b.restaurant_id = new.restaurant_id and b.slug = s
   )
   limit 1;

  if v_invalido is not null then
    raise exception 'Selo "%" não existe neste restaurante', v_invalido
      using errcode = '45120';
  end if;

  return new;
end;
$$;

create trigger products_selos_existem
  before insert or update of badges on public.products
  for each row execute function app.selos_existem();

-- -----------------------------------------------------------------------------
-- Selo interno não se apaga.
--
-- Produtos antigos referenciam `novo`, `picante` e companhia. Apagar a linha
-- deixaria o selo órfão no cardápio — e o trigger acima recusaria a próxima
-- edição daquele produto, com uma mensagem que ninguém liga ao selo que sumiu.
-- Desativar (`active = false`) continua permitido e é o caminho certo.
-- -----------------------------------------------------------------------------
create or replace function app.selo_interno_nao_apaga()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

create trigger product_badges_nao_apaga_em_uso
  before delete on public.product_badges
  for each row execute function app.selo_interno_nao_apaga();
