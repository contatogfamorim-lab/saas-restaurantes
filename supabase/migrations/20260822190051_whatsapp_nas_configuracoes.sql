-- =============================================================================
-- 0051 — O WhatsApp entra nas configurações da casa
-- =============================================================================
-- A 0050 criou `evolution_instance_name` e `marketing_max_por_dia` e não deu a
-- ninguém como preencher. Ficou uma coluna que só o `psql` alcança — e uma
-- funcionalidade que existe no banco e não existe para quem usa.
--
-- POR QUE EM `atualizar_configuracoes` E NÃO NUMA FUNÇÃO NOVA
--
-- Porque já é o lugar. Ela é `owner` e só, audita antes-e-depois, e ignora
-- campo ausente em vez de apagar. Uma segunda função para dois campos criaria
-- um segundo conjunto de regras para manter em sincronia com o primeiro — e a
-- que ficasse para trás seria a frouxa.
--
-- E porque `owner` é o recorte certo: gerente monta e dispara campanha, mas
-- ligar o WhatsApp da casa a uma instância é decisão de dono. Errar a instância
-- manda a campanha pelo número de outro restaurante.
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
    'nome', name,
    'taxa_servico', service_fee_pct,
    'cashback', cashback_pct,
    'timezone', timezone,
    'pedir_telefone', require_phone,
    'cor', brand_color,
    'whatsapp', evolution_instance_name,
    'teto_diario', marketing_max_por_dia
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

         -- O nome da instância na Evolution.
         --
         -- String vazia vira NULL de propósito, e é o único jeito de
         -- DESCONECTAR: sem isso, quem apagasse o campo na tela ficaria com a
         -- instância antiga gravada e continuaria disparando por ela.
         --
         -- O formato é apertado — letras, números, hífen e sublinhado — porque
         -- este valor vai direto para o CAMINHO de uma URL. Barra ou ponto
         -- aqui viraria travessia de caminho na chamada à Evolution.
         evolution_instance_name = case
           when not (p_valores ? 'whatsapp') then evolution_instance_name
           when btrim(p_valores ->> 'whatsapp') = '' then null
           when btrim(p_valores ->> 'whatsapp') ~ '^[A-Za-z0-9_-]{2,60}$'
             then btrim(p_valores ->> 'whatsapp')
           else evolution_instance_name
         end,

         -- O teto do dia, com os mesmos limites do CHECK da tabela. Repetido
         -- aqui para o valor ser APARADO em vez de derrubar a gravação inteira
         -- por causa de um número digitado errado.
         marketing_max_por_dia = case
           when p_valores ? 'teto_diario'
             then least(greatest((p_valores ->> 'teto_diario')::int, 0), 2000)
           else marketing_max_por_dia end

   where id = v_restaurante;

  select jsonb_build_object(
    'nome', name,
    'taxa_servico', service_fee_pct,
    'cashback', cashback_pct,
    'timezone', timezone,
    'pedir_telefone', require_phone,
    'cor', brand_color,
    'whatsapp', evolution_instance_name,
    'teto_diario', marketing_max_por_dia
  ) into v_depois
  from public.restaurants where id = v_restaurante;

  if v_antes is distinct from v_depois then
    insert into public.audit_log
      (restaurant_id, actor_type, actor_id, action, entity_type, entity_id,
       before, after)
    values
      -- `restaurant.settings_changed`, e não `restaurant.settings`.
      --
      -- Reescrever a função inteira aqui trocou este nome sem querer, e o teste
      -- da 0041 pegou. O nome importa: é por ele que a auditoria filtra, e a
      -- troca teria partido o histórico em dois — as mudanças de antes com um
      -- rótulo, as de depois com outro, e nenhuma consulta enxergando as duas.
      (v_restaurante, 'staff', auth.uid(), 'restaurant.settings_changed', 'restaurant',
       v_restaurante, v_antes, v_depois);
  end if;

  return v_depois;
end;
$$;

-- -----------------------------------------------------------------------------
-- A escrita direta continua fechada.
--
-- `atualizar_configuracoes` não é `security definer`: ela roda com o papel de
-- quem chamou, e a RLS de `restaurants` é que decide. As colunas novas entram
-- nesse mesmo regime — não há GRANT novo aqui, e é de propósito.
-- -----------------------------------------------------------------------------
