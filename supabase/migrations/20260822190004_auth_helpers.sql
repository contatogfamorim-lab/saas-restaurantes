-- =============================================================================
-- 0004 — Helpers de autorização
-- =============================================================================
-- Vem DEPOIS de 0003 porque estas funções consultam `public.profiles`, e
-- função `language sql` tem o corpo validado no momento do CREATE.
--
-- SECURITY DEFINER é obrigatório aqui: a policy de `profiles` consulta
-- `profiles`, e sem definer o Postgres entra em recursão infinita. Todas com
-- `search_path = ''` (blindagem contra search_path hijacking) e `stable`.
--
-- Nota (spec §10.2): a proibição de SECURITY DEFINER vale para VIEWS, que
-- contornariam RLS silenciosamente. As views deste projeto são todas
-- `security_invoker = on` (ver 0012). Estas funções são o oposto: existem
-- justamente para tornar a policy avaliável.
--
-- Os GRANTs de EXECUTE ficam no fim de 0013, depois de todas as funções
-- existirem — EXECUTE em função nova é concedido a PUBLIC por padrão, e isso
-- precisa ser revogado de uma vez só.
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

-- Devolve text[], não staff_role[]: o cast é explícito porque o Postgres NÃO
-- converte array de enum para array de texto implicitamente, e trabalhar com
-- text[] deixa os helpers utilizáveis sem arrastar o tipo enum para toda policy.
create or replace function app.current_roles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.roles::text[], '{}'::text[])
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
