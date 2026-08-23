-- =============================================================================
-- 0022 — Acesso por código de operador e aparelho confiável
-- =============================================================================
-- Modelo de acesso:
--
--   Administrador  →  e-mail + senha
--   Todo o resto   →  código de operador + senha de 5 dígitos
--
-- 5 dígitos são 100.000 combinações. Isso NÃO é senha forte, e não pode ser
-- tratada como se fosse. O que a torna aceitável são três coisas juntas, e a
-- ausência de qualquer uma derruba as outras:
--
--   1. APARELHO CONFIÁVEL. O teclado numérico só aparece em aparelho que o
--      Administrador liberou com e-mail e senha. Sem isso, o endpoint ficaria
--      exposto na internet aberta e 100 mil tentativas são questão de minutos
--      (spec §10.5: "PIN não é credencial exposta à internet aberta").
--   2. BLOQUEIO. 5 erros travam o operador por 15 minutos.
--   3. AUDITORIA. Toda tentativa falha vai para audit_log.
--
-- O código de operador é NOME DE USUÁRIO, não segredo: ele fica escrito no
-- crachá e todo mundo na casa sabe. O segredo são os 5 dígitos.
-- =============================================================================

alter table public.profiles
  add column operator_code text
    check (operator_code ~ '^[0-9]{2,6}$');

-- Único POR RESTAURANTE, não global: o código 01 do Brasa Burger não tem
-- nada a ver com o 01 da casa vizinha, e exigir unicidade global obrigaria
-- cada restaurante novo a inventar códigos maiores.
create unique index profiles_operator_code_por_restaurante
  on public.profiles (restaurant_id, operator_code)
  where operator_code is not null;

comment on column public.profiles.operator_code is
  'Identificador curto que o operador digita no teclado. É nome de usuário, '
  'não segredo — fica no crachá. O segredo é pin_hash.';

comment on column public.profiles.pin_hash is
  'argon2id da senha de 5 dígitos do operador. O Administrador não usa: ele '
  'entra por e-mail e senha do Supabase Auth.';

-- =============================================================================
-- Aparelhos confiáveis
-- =============================================================================
-- Uma tabela em vez de só um cookie assinado porque tablet de restaurante some,
-- quebra e é levado para casa. Precisa dar para revogar UM aparelho sem
-- derrubar os outros e sem trocar segredo de ninguém.
-- =============================================================================
create table public.trusted_devices (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label         text not null check (length(btrim(label)) between 1 and 60),
  -- Guardamos o HASH do token; o valor cru vive só no cookie do aparelho.
  -- Se a base vazar, ela não devolve o acesso de nenhum tablet.
  token_hash    text not null unique,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid,

  foreign key (created_by, restaurant_id)
    references public.profiles (id, restaurant_id) on delete set null,
  foreign key (revoked_by, restaurant_id)
    references public.profiles (id, restaurant_id) on delete set null
);

create index trusted_devices_ativos
  on public.trusted_devices (restaurant_id) where revoked_at is null;

alter table public.trusted_devices enable row level security;

-- Quem administra vê e revoga os aparelhos da própria casa. Ninguém mais:
-- a lista de aparelhos liberados é mapa de onde o sistema está aberto.
create policy trusted_devices_admin on public.trusted_devices
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_role('owner'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_role('owner'));

revoke all on public.trusted_devices from anon;
grant select, insert, update on public.trusted_devices to authenticated;
grant all on public.trusted_devices to service_role;

-- =============================================================================
-- Bloqueio por tentativa errada (spec §10.5)
-- =============================================================================
-- No banco, e não na aplicação: contador em memória de processo não sobrevive
-- a duas instâncias, e é justamente sob carga que alguém tentaria força bruta.
--
-- SECURITY DEFINER porque roda ANTES de existir sessão — quem chama é o
-- servidor, no meio da autenticação, sem auth.uid() ainda.
-- =============================================================================
create or replace function app.register_pin_failure(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil record;
  v_bloqueado_ate timestamptz;
begin
  update public.profiles
     set pin_failed_attempts = pin_failed_attempts + 1,
         pin_locked_until = case
           when pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
           else pin_locked_until
         end
   where id = p_profile_id
  returning * into v_perfil;

  if not found then
    return jsonb_build_object('bloqueado', false, 'tentativas', 0);
  end if;

  v_bloqueado_ate := v_perfil.pin_locked_until;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_perfil.restaurant_id, 'system', p_profile_id, 'operator.pin_failed',
     'profiles', p_profile_id,
     jsonb_build_object('tentativas', v_perfil.pin_failed_attempts,
                        'bloqueado_ate', v_bloqueado_ate));

  return jsonb_build_object(
    'bloqueado', v_bloqueado_ate is not null and v_bloqueado_ate > now(),
    'tentativas', v_perfil.pin_failed_attempts,
    'bloqueado_ate', v_bloqueado_ate
  );
end;
$$;

create or replace function app.register_pin_success(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid;
begin
  update public.profiles
     set pin_failed_attempts = 0, pin_locked_until = null
   where id = p_profile_id
  returning restaurant_id into v_restaurant_id;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id)
  values
    (v_restaurant_id, 'staff', p_profile_id, 'operator.signed_in',
     'profiles', p_profile_id);
end;
$$;

revoke all on function app.register_pin_failure(uuid) from public, anon, authenticated;
revoke all on function app.register_pin_success(uuid) from public, anon, authenticated;
grant execute on function app.register_pin_failure(uuid) to service_role;
grant execute on function app.register_pin_success(uuid) to service_role;
