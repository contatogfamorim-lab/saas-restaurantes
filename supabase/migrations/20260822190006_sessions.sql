-- =============================================================================
-- 0006 — table_sessions (A COMANDA) e session_guests
-- =============================================================================

create table public.table_sessions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  table_id       uuid not null,
  status         public.session_status not null default 'open',
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  waiter_id      uuid,
  guest_count    int check (guest_count between 1 and 60),
  notes          text check (length(notes) <= 1000),

  released_by    uuid,
  released_at    timestamptz,
  release_reason public.release_reason,
  release_note   text check (length(release_note) <= 500),
  force_released boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  foreign key (table_id, restaurant_id)
    references public.restaurant_tables (id, restaurant_id) on delete restrict,
  foreign key (waiter_id, restaurant_id)
    references public.profiles (id, restaurant_id) on delete set null,
  foreign key (released_by, restaurant_id)
    references public.profiles (id, restaurant_id) on delete set null,
  unique (id, restaurant_id),

  -- liberação forçada SEMPRE com motivo (spec §5)
  check (not force_released or release_reason is not null),
  check (release_reason is distinct from 'outro' or release_note is not null),
  check (status not in ('closed', 'cancelled') or closed_at is not null)
);

-- REGRA INEGOCIÁVEL (spec §3, regra 2): uma única sessão aberta por mesa.
-- 'closing' entra no índice junto com 'open': a mesa segue ocupada enquanto o
-- caixa fecha a conta. Cobrir só 'open' deixaria uma segunda comanda nascer
-- entre o "pedir a conta" e o "liberar mesa".
create unique index table_sessions_one_open_per_table
  on public.table_sessions (table_id) where status in ('open', 'closing');

create index table_sessions_open_idx
  on public.table_sessions (restaurant_id, opened_at desc)
  where status in ('open', 'closing');
create index table_sessions_released_idx
  on public.table_sessions (restaurant_id, released_at desc)
  where force_released;

comment on index public.table_sessions_one_open_per_table is
  'Impede duas comandas simultâneas na mesma mesa. Garantia do banco: a corrida '
  'entre dois celulares abrindo a mesma mesa falha no INSERT, não na aplicação.';

-- -----------------------------------------------------------------------------
-- session_guests — cada pessoa sentada. É o que permite dividir a conta.
-- LGPD (spec §10.9): só nome e telefone. Nada de CPF, e-mail ou nascimento.
-- -----------------------------------------------------------------------------
create table public.session_guests (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete restrict,
  session_id      uuid not null,
  display_name    text not null check (length(btrim(display_name)) between 1 and 60),
  phone           text check (phone ~ '^\+?[0-9]{10,15}$'),
  device_hash     text,
  joined_at       timestamptz not null default now(),
  lgpd_consent_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete cascade,
  unique (id, restaurant_id),

  -- telefone só pode existir com consentimento registrado e datado
  check (phone is null or lgpd_consent_at is not null)
);

comment on column public.session_guests.phone is
  'Mascarado por padrão nas telas (•••••-1234). Completo só para manager/owner, '
  'e com registro em audit_log (spec §10.9).';
comment on column public.session_guests.device_hash is
  'Hash do device do cliente, para reconhecer quem já se identificou na mesa. '
  'Não é identificador pessoal — não guarda user-agent nem IP.';

create index session_guests_session_idx on public.session_guests (session_id);
create index session_guests_phone_idx
  on public.session_guests (restaurant_id, phone) where phone is not null;

create trigger touch_table_sessions before update on public.table_sessions
  for each row execute function app.touch_updated_at();
create trigger touch_session_guests before update on public.session_guests
  for each row execute function app.touch_updated_at();
