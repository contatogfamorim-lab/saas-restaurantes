-- =============================================================================
-- 0055 — Carência e validade entram nas configurações
-- =============================================================================
-- Mesmo motivo da 0051: a 0053 criou duas colunas e não deu a ninguém como
-- preenchê-las. Coluna que só o `psql` alcança é funcionalidade que não existe.
--
-- Vão para `atualizar_configuracoes` porque já é o lugar: `owner` e só, audita
-- antes-e-depois, campo ausente não altera. E porque cashback sai do bolso da
-- casa — a mesma razão que já fazia a porcentagem ser exclusiva do dono.
-- =============================================================================
create or replace function public.atualizar_configuracoes(p_valores jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_antes jsonb;
  v_depois jsonb;
begin
  if not app.has_any_role('owner') then
    raise exception 'Só quem administra muda as configurações da casa'
      using errcode = '45110';
  end if;

  select jsonb_build_object(
    'nome', name, 'taxa_servico', service_fee_pct, 'cashback', cashback_pct,
    'timezone', timezone, 'pedir_telefone', require_phone, 'cor', brand_color,
    'whatsapp', evolution_instance_name, 'teto_diario', marketing_max_por_dia,
    'carencia', cashback_carencia_horas, 'validade', cashback_validade_dias
  ) into v_antes
  from public.restaurants where id = v_restaurante;

  update public.restaurants
     set name = coalesce(nullif(btrim(p_valores ->> 'nome'), ''), name),

         service_fee_pct = case
           when p_valores ? 'taxa_servico'
             then least(greatest((p_valores ->> 'taxa_servico')::numeric, 0), 30)
           else service_fee_pct end,

         cashback_pct = case
           when p_valores ? 'cashback'
             then least(greatest((p_valores ->> 'cashback')::numeric, 0), 20)
           else cashback_pct end,

         timezone = coalesce(nullif(p_valores ->> 'timezone', ''), timezone),

         require_phone = case
           when p_valores ? 'pedir_telefone'
             then (p_valores ->> 'pedir_telefone')::boolean
           else require_phone end,

         brand_color = case
           when p_valores ->> 'cor' ~ '^#[0-9A-Fa-f]{6}$'
             then p_valores ->> 'cor'
           else brand_color end,

         evolution_instance_name = case
           when not (p_valores ? 'whatsapp') then evolution_instance_name
           when btrim(p_valores ->> 'whatsapp') = '' then null
           when btrim(p_valores ->> 'whatsapp') ~ '^[A-Za-z0-9_-]{2,60}$'
             then btrim(p_valores ->> 'whatsapp')
           else evolution_instance_name
         end,

         marketing_max_por_dia = case
           when p_valores ? 'teto_diario'
             then least(greatest((p_valores ->> 'teto_diario')::int, 0), 2000)
           else marketing_max_por_dia end,

         -- Aparados nos mesmos limites do CHECK da tabela, para um número
         -- digitado errado ser CORRIGIDO em vez de derrubar a gravação inteira.
         cashback_carencia_horas = case
           when p_valores ? 'carencia'
             then least(greatest((p_valores ->> 'carencia')::int, 0), 720)
           else cashback_carencia_horas end,

         cashback_validade_dias = case
           when p_valores ? 'validade'
             then least(greatest((p_valores ->> 'validade')::int, 0), 3650)
           else cashback_validade_dias end

   where id = v_restaurante;

  select jsonb_build_object(
    'nome', name, 'taxa_servico', service_fee_pct, 'cashback', cashback_pct,
    'timezone', timezone, 'pedir_telefone', require_phone, 'cor', brand_color,
    'whatsapp', evolution_instance_name, 'teto_diario', marketing_max_por_dia,
    'carencia', cashback_carencia_horas, 'validade', cashback_validade_dias
  ) into v_depois
  from public.restaurants where id = v_restaurante;

  if v_antes is distinct from v_depois then
    insert into public.audit_log
      (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, before, after)
    values
      (v_restaurante, 'staff', auth.uid(), 'restaurant.settings_changed', 'restaurant',
       v_restaurante, v_antes, v_depois);
  end if;

  return v_depois;
end;
$$;
