-- =============================================================================
-- 0005 — Promoções
-- =============================================================================

create table public.promotions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  name           text not null check (length(btrim(name)) between 1 and 120),
  status         public.promotion_status not null default 'draft',

  starts_at      timestamptz,
  ends_at        timestamptz,
  days_of_week   int[] check (days_of_week <@ array[0,1,2,3,4,5,6]),
  time_from      time,
  time_to        time,

  discount_type  public.discount_type not null,
  -- fixed_price → centavos do preço final; percent → 0..100.
  -- Ignorado em buy_x_pay_y e free_item.
  discount_value numeric(10,2),
  -- spec §12.12 pede "leve X pague Y", que um único discount_value não expressa.
  buy_quantity   int check (buy_quantity >= 2),
  pay_quantity   int check (pay_quantity >= 1),

  max_quantity   int check (max_quantity >= 1),   -- null = ilimitada
  used_quantity  int not null default 0 check (used_quantity >= 0),
  min_order_cents int check (min_order_cents >= 0),

  priority       int not null default 0,
  is_stackable   boolean not null default false,

  badge_label    text check (length(badge_label) <= 24),
  badge_color    text check (badge_color ~* '^#[0-9a-f]{6}$'),

  applies_to     public.promotion_applies_to not null default 'auto',
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (id, restaurant_id),
  check ((time_from is null) = (time_to is null)),
  check (starts_at is null or ends_at is null or ends_at > starts_at),
  check (max_quantity is null or used_quantity <= max_quantity),

  -- cada tipo de desconto exige o seu próprio conjunto de campos
  check (
    case discount_type
      when 'fixed_price' then discount_value is not null and discount_value >= 0
      when 'percent'     then discount_value is not null
                              and discount_value > 0 and discount_value <= 100
      when 'buy_x_pay_y' then buy_quantity is not null and pay_quantity is not null
                              and pay_quantity < buy_quantity
      when 'free_item'   then true
    end
  )
);

comment on column public.promotions.is_stackable is
  'FALSE por padrão. Duas promoções válidas no mesmo item: vence a de maior '
  'priority. Acúmulo acidental já quebrou o caixa de muita casa (spec §12.12).';
comment on column public.promotions.used_quantity is
  'Decrementado por app.claim_promotion_quantity(), nunca pela aplicação.';

create index promotions_live_idx
  on public.promotions (restaurant_id, priority desc)
  where status = 'active';

create table public.promotion_targets (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  promotion_id  uuid not null,
  target_type   public.promotion_target_type not null,
  target_id     uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  foreign key (promotion_id, restaurant_id)
    references public.promotions (id, restaurant_id) on delete cascade,
  unique (promotion_id, target_type, target_id)
);

create index promotion_targets_lookup_idx
  on public.promotion_targets (restaurant_id, target_type, target_id);

create trigger touch_promotions before update on public.promotions
  for each row execute function app.touch_updated_at();
create trigger touch_promotion_targets before update on public.promotion_targets
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- "Está valendo AGORA?" — janela de datas + dia da semana + horário + estoque.
-- Promoção fora da janela ou esgotada some sozinha, sem ninguém mexer.
-- -----------------------------------------------------------------------------
create or replace function app.promotion_is_live(
  p public.promotions,
  p_timezone text default 'America/Sao_Paulo',
  p_at timestamptz default now()
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.status = 'active'
     and (p.starts_at is null or p.starts_at <= p_at)
     and (p.ends_at   is null or p.ends_at   >  p_at)
     and (p.max_quantity is null or p.used_quantity < p.max_quantity)
     and app.is_within_service_window(
           p.time_from, p.time_to, p.days_of_week, p_timezone, p_at)
$$;

-- -----------------------------------------------------------------------------
-- Reserva atômica de estoque de promoção.
-- O UPDATE ... WHERE trava a linha: dois clientes pedindo a última unidade ao
-- mesmo tempo serializam, e o segundo recebe FALSE. Esta checagem NÃO pode
-- viver na aplicação (spec §12.12).
-- -----------------------------------------------------------------------------
create or replace function app.claim_promotion_quantity(
  p_promotion_id uuid,
  p_qty int default 1
)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  claimed int;
begin
  if p_qty <= 0 then
    raise exception 'Quantidade reservada precisa ser positiva';
  end if;

  update public.promotions
     set used_quantity = used_quantity + p_qty
   where id = p_promotion_id
     and (max_quantity is null or used_quantity + p_qty <= max_quantity)
  returning 1 into claimed;

  return claimed is not null;
end;
$$;

comment on function app.claim_promotion_quantity(uuid, int) is
  'Reserva estoque de promoção de forma atômica. Retorna FALSE quando esgotou.';
