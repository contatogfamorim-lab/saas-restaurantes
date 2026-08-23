-- =============================================================================
-- 0018 — open_guest_session: identificação do cliente e abertura da comanda
-- =============================================================================
-- Acontece no PRIMEIRO envio de pedido, nunca ao abrir o cardápio (spec §4):
-- "Cardápio abre livre. Zero fricção." Pedir nome antes de a pessoa ver a
-- comida é o jeito mais rápido de ela desistir e chamar o garçom.
--
-- SQLSTATEs:
--   45010 mesa/etiqueta não encontrada
--   45011 abertura de mesa exige garçom
--   45012 telefone obrigatório neste restaurante
--   45013 nome inválido
-- =============================================================================

create or replace function public.open_guest_session(
  p_short_code    text,
  p_display_name  text,
  p_phone         text,
  p_device_hash   text,
  p_lgpd_consent  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table       record;
  v_session_id  uuid;
  v_guest_id    uuid;
  v_name        text;
  v_phone       text;
  v_reused      boolean := false;
begin
  -- ---------------------------------------------------------------------------
  select t.id, t.restaurant_id, t.label,
         r.require_phone, r.require_waiter_to_open_table
  into v_table
  from public.restaurant_tables t
  join public.restaurants r on r.id = t.restaurant_id
  where t.short_code = p_short_code
    and t.active
    and r.active;

  if not found then
    raise exception 'Mesa não encontrada' using errcode = '45010';
  end if;

  v_name := btrim(coalesce(p_display_name, ''));
  if length(v_name) < 1 or length(v_name) > 60 then
    raise exception 'Informe um nome de 1 a 60 caracteres' using errcode = '45013';
  end if;

  -- Só dígitos: o cliente digita "(11) 99888-7766" e o CHECK da tabela espera
  -- o formato limpo. Normalizar aqui evita rejeitar telefone válido por causa
  -- de parêntese.
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');

  if v_table.require_phone and v_phone is null then
    raise exception 'Este restaurante pede telefone para enviar o pedido'
      using errcode = '45012';
  end if;

  if v_phone is not null then
    if length(v_phone) < 10 or length(v_phone) > 15 then
      raise exception 'Telefone inválido' using errcode = '45012';
    end if;
    -- LGPD (spec §10.9): telefone só entra com consentimento explícito, e o
    -- CHECK da tabela recusa telefone sem lgpd_consent_at. Guardar o dado sem
    -- registro do consentimento é o que gera multa.
    if not coalesce(p_lgpd_consent, false) then
      v_phone := null;
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- Trava por mesa. Sem ela, dois celulares tocando "enviar" ao mesmo tempo
  -- disparam dois INSERT de sessão e um estoura no índice único parcial.
  -- Advisory lock em vez de ON CONFLICT porque a inferência de índice parcial
  -- é frágil a mudanças no predicado.
  -- ---------------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended(v_table.id::text, 0));

  select s.id into v_session_id
  from public.table_sessions s
  where s.table_id = v_table.id and s.status = 'open';

  if v_session_id is null then
    -- Casa que exige o garçom para abrir mesa (restaurants.require_waiter_to_open_table)
    if v_table.require_waiter_to_open_table then
      raise exception 'Chame o garçom para abrir a mesa' using errcode = '45011';
    end if;

    insert into public.table_sessions (restaurant_id, table_id)
    values (v_table.restaurant_id, v_table.id)
    returning id into v_session_id;
  end if;

  -- ---------------------------------------------------------------------------
  -- Mesmo aparelho, mesma sessão: reaproveita o cliente já identificado.
  -- É o que faz a spec §4 valer — "nas próximas rodadas não pergunta mais nada".
  -- ---------------------------------------------------------------------------
  if p_device_hash is not null then
    select g.id into v_guest_id
    from public.session_guests g
    where g.session_id = v_session_id and g.device_hash = p_device_hash;
  end if;

  if v_guest_id is not null then
    v_reused := true;
    -- deixa a pessoa corrigir o próprio nome, e só ACRESCENTA telefone
    update public.session_guests
       set display_name    = v_name,
           phone           = coalesce(v_phone, phone),
           lgpd_consent_at = case
                               when v_phone is not null then coalesce(lgpd_consent_at, now())
                               else lgpd_consent_at
                             end
     where id = v_guest_id;
  else
    insert into public.session_guests
      (restaurant_id, session_id, display_name, phone, device_hash, lgpd_consent_at)
    values
      (v_table.restaurant_id, v_session_id, v_name, v_phone, p_device_hash,
       case when v_phone is not null then now() end)
    returning id into v_guest_id;
  end if;

  return jsonb_build_object(
    'session_id',    v_session_id,
    'guest_id',      v_guest_id,
    'restaurant_id', v_table.restaurant_id,
    'table_id',      v_table.id,
    'table_label',   v_table.label,
    'reused',        v_reused
  );
end;
$$;

comment on function public.open_guest_session(text, text, text, text, boolean) is
  'Abre ou reaproveita a comanda da mesa e identifica o cliente. Chamada só '
  'pelo Route Handler, que emite o cookie assinado a partir do retorno.';

revoke all on function public.open_guest_session(text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.open_guest_session(text, text, text, text, boolean)
  to service_role;
