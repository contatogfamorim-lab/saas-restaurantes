-- =============================================================================
-- 0048 — Restrições: o mesmo tratamento dos selos
-- =============================================================================
-- Cinco valores fixos num enum — vegetariano, vegano, sem glúten, sem lactose,
-- apimentado — e todos desenhados iguais. Uma casa que precise de "SEM CASTANHA",
-- "HALAL" ou "SEM FRUTOS DO MAR" não tinha como.
--
-- Agora são cadastro da casa, como os selos da 0043.
--
-- MAS AQUI TEM UMA DIFERENÇA QUE IMPORTA
--
-- Selo é marketing; restrição é SEGURANÇA. A tela do editor já dizia, e continua
-- dizendo: "errar aqui é sério, alguém com alergia acredita". Duas consequências
-- concretas no desenho:
--
--   1. os cinco originais são `built_in` e NÃO se apagam. Uma casa que apagasse
--      "sem glúten" deixaria pratos marcados apontando para nada — e o filtro do
--      cliente celíaco pararia de encontrá-los;
--
--   2. restrição não ganha ANIMAÇÃO. Selo pisca para vender; aviso de alergia
--      não é vitrine, e fazer "SEM CASTANHA" brilhar seria confundir as duas
--      coisas. Cor sim, movimento não.
-- =============================================================================

create table public.diet_restrictions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,

  slug          text not null check (slug ~ '^[a-z0-9_]{2,32}$'),

  -- O que aparece no card, curto. "S/ GLÚTEN" e não "Não contém glúten".
  label         text not null check (length(btrim(label)) between 2 and 14),

  -- O nome inteiro, para a lista de marcação no editor e para o filtro.
  label_long    text not null check (length(btrim(label_long)) between 2 and 40),

  color         text not null default '#64748B' check (color ~ '^#[0-9A-Fa-f]{6}$'),

  sort_order    int not null default 0,
  active        boolean not null default true,
  built_in      boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (restaurant_id, slug)
);

create index diet_restrictions_do_restaurante_idx
  on public.diet_restrictions (restaurant_id, sort_order);

alter table public.diet_restrictions enable row level security;

-- Mesma função `security definer` que as outras tabelas públicas usam. Um
-- `exists` em `restaurants` morreria com "permission denied" e as restrições
-- sumiriam do cardápio em silêncio — foi o erro que os selos me ensinaram.
create policy restricoes_public_read on public.diet_restrictions
  for select to anon
  using (active and app.restaurant_is_active(restaurant_id));

create policy restricoes_staff_read on public.diet_restrictions
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

create policy restricoes_staff_write on public.diet_restrictions
  for all to authenticated
  using (
    restaurant_id = app.current_restaurant_id()
    and app.has_menu_permission('menu.content')
  )
  with check (
    restaurant_id = app.current_restaurant_id()
    and app.has_menu_permission('menu.content')
  );

grant select on public.diet_restrictions to anon;
grant select, insert, update, delete on public.diet_restrictions to authenticated;
grant select on public.diet_restrictions to service_role;

-- -----------------------------------------------------------------------------
-- As cinco de sempre, para toda casa — inclusive as que nascerem depois.
--
-- Função + trigger, e não INSERT solto: foi a lição da 0043, onde o seed insere
-- o restaurante DEPOIS das migrations e subia sem selo nenhum.
--
-- As cores separam o que é ESCOLHA do que é AVISO: verde para dieta
-- (vegetariano, vegano), azul para ausência de ingrediente (sem glúten, sem
-- lactose), vermelho para o que arde. Quem procura por alergia está procurando
-- azul, e isso é mais rápido de varrer que ler cinco etiquetas iguais.
-- -----------------------------------------------------------------------------
create or replace function app.criar_restricoes_internas(p_restaurante uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.diet_restrictions
    (restaurant_id, slug, label, label_long, color, sort_order, built_in)
  select p_restaurante, d.slug, d.label, d.longo, d.cor, d.ord, true
    from (values
      ('vegetariano', 'VEG',        'Vegetariano',  '#3FA34D', 1),
      ('vegano',      'VEGANO',     'Vegano',       '#2E7D32', 2),
      ('sem_gluten',  'S/ GLÚTEN',  'Sem glúten',   '#0EA5E9', 3),
      ('sem_lactose', 'S/ LACTOSE', 'Sem lactose',  '#0284C7', 4),
      ('apimentado',  'PICANTE',    'Apimentado',   '#DC2626', 5)
    ) as d(slug, label, longo, cor, ord)
  on conflict (restaurant_id, slug) do nothing;
$$;

create or replace function app.restricoes_ao_nascer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.criar_restricoes_internas(new.id);
  return new;
end;
$$;

create trigger restaurants_ganham_restricoes
  after insert on public.restaurants
  for each row execute function app.restricoes_ao_nascer();

select app.criar_restricoes_internas(id) from public.restaurants;

-- -----------------------------------------------------------------------------
-- `products.diet_tags`: de `diet_tag[]` para `text[]`.
-- -----------------------------------------------------------------------------
alter table public.products
  alter column diet_tags type text[] using diet_tags::text[];

/**
 * Toda restrição posta num produto tem de existir na casa.
 *
 * Vale mais aqui que nos selos: restrição órfã não é só um retângulo faltando —
 * é um prato que o cliente celíaco não encontra no filtro.
 */
create or replace function app.restricoes_existem()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invalido text;
begin
  if new.diet_tags is null or array_length(new.diet_tags, 1) is null then
    return new;
  end if;

  select s into v_invalido
    from unnest(new.diet_tags) as s
   where not exists (
     select 1 from public.diet_restrictions d
      where d.restaurant_id = new.restaurant_id and d.slug = s
   )
   limit 1;

  if v_invalido is not null then
    raise exception 'Restrição "%" não existe neste restaurante', v_invalido
      using errcode = '45130';
  end if;

  return new;
end;
$$;

create trigger products_restricoes_existem
  before insert or update of diet_tags on public.products
  for each row execute function app.restricoes_existem();

-- -----------------------------------------------------------------------------
-- Restrição interna não se apaga — exceto quando a casa inteira vai embora.
--
-- Mesma condição da fresta do `audit_log` (0034) e dos selos (0044): só
-- demonstração, só depois de vencida.
-- -----------------------------------------------------------------------------
create or replace function app.restricao_interna_nao_apaga()
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
    raise exception 'Esta restrição é do sistema: desative em vez de apagar'
      using errcode = '45131';
  end if;

  if exists (
    select 1 from public.products p
     where p.restaurant_id = old.restaurant_id and old.slug = any(p.diet_tags)
  ) then
    raise exception 'Há pratos usando esta restrição. Tire-os antes de apagar'
      using errcode = '45132';
  end if;

  return old;
end;
$$;

create trigger diet_restrictions_nao_apaga_em_uso
  before delete on public.diet_restrictions
  for each row execute function app.restricao_interna_nao_apaga();
