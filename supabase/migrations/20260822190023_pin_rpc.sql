-- =============================================================================
-- 0023 — Move o controle de tentativas de PIN para `public`
-- =============================================================================
-- O PostgREST só expõe `public`, e o servidor chama estas funções por `rpc()`
-- durante a autenticação — antes de existir sessão. Em `app` elas eram
-- inalcançáveis.
--
-- Estar em `public` NÃO significa estar aberto: o grant é exclusivo de
-- `service_role`, como em `create_guest_order` e `open_guest_session`. Quem
-- alcança é o servidor, nunca o browser.
-- =============================================================================

drop function if exists app.register_pin_failure(uuid);
drop function if exists app.register_pin_success(uuid);

/**
 * Contabiliza uma tentativa errada e bloqueia na quinta.
 *
 * No banco, e não na aplicação: contador em memória de processo não sobrevive
 * a duas instâncias, e é justamente sob carga que alguém tentaria força bruta.
 *
 * SECURITY DEFINER porque roda ANTES de existir sessão — não há `auth.uid()`
 * no meio de uma autenticação que ainda não deu certo.
 */
create or replace function public.register_pin_failure(p_profile_id uuid)
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

create or replace function public.register_pin_success(p_profile_id uuid)
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

revoke all on function public.register_pin_failure(uuid) from public, anon, authenticated;
revoke all on function public.register_pin_success(uuid) from public, anon, authenticated;
grant execute on function public.register_pin_failure(uuid) to service_role;
grant execute on function public.register_pin_success(uuid) to service_role;
