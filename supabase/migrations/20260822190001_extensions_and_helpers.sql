-- =============================================================================
-- 0001 — Extensões, schema privado de helpers e funções de apoio a RLS
-- =============================================================================
-- O schema `app` NÃO é exposto pelo PostgREST (ver supabase/config.toml,
-- api.schemas). Helpers de autorização vivem aqui para não virarem endpoint.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- short_code das mesas: nanoid de 10 chars, alfabeto URL-safe sem ambiguidade.
-- Aleatório por definição — jamais sequencial nem derivado do número da mesa
-- (spec §10.4: senão qualquer um enumera as mesas de todos os restaurantes).
-- -----------------------------------------------------------------------------
create or replace function app.generate_short_code(size int default 10)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- sem 0/O/1/I/l: o código também é impresso no adesivo e digitado à mão
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  alphabet_len constant int := length(alphabet);
  result text := '';
  idx int;
begin
  for i in 1..size loop
    idx := 1 + (get_byte(extensions.gen_random_bytes(1), 0) % alphabet_len);
    result := result || substr(alphabet, idx, 1);
  end loop;
  return result;
end;
$$;

-- =============================================================================
-- Helpers de autorização
-- =============================================================================
-- SECURITY DEFINER é obrigatório aqui: a policy de `profiles` consulta
-- `profiles`, e sem definer o Postgres entra em recursão infinita. Todas com
-- `search_path = ''` (blindagem contra search_path hijacking) e `stable`.
--
-- Nota (spec §10.2): a proibição de SECURITY DEFINER vale para VIEWS, que
-- contornariam RLS silenciosamente. As views deste projeto são todas
-- `security_invoker = on` (ver 0011). Estas funções são o oposto: existem
-- justamente para tornar a policy avaliável.
-- =============================================================================

create or replace function app.current_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.restaurant_id
  from public.profiles p
  where p.id = (select auth.uid()) and p.active
$$;

create or replace function app.current_roles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.roles, '{}')
  from public.profiles p
  where p.id = (select auth.uid()) and p.active
$$;

create or replace function app.current_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.permissions, '{}')
  from public.profiles p
  where p.id = (select auth.uid()) and p.active
$$;

-- Pertinência no ARRAY. Nunca igualdade com campo único — um funcionário
-- acumula funções (spec P1b: caixa que também é garçom).
create or replace function app.has_role(target_role text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select target_role = any(app.current_roles())
$$;

create or replace function app.has_any_role(variadic target_roles text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_roles() && target_roles
$$;

-- Pertence ao restaurante X e está ativo?
create or replace function app.is_staff_of(target_restaurant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select target_restaurant_id is not null
     and target_restaurant_id = app.current_restaurant_id()
$$;

comment on function app.has_role(text) is
  'Testa pertinência no array profiles.roles. Nunca comparar roles por igualdade.';
