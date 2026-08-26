-- =============================================================================
-- 0041 — Configurações da casa, depois do briefing
-- =============================================================================
-- O QUE FALTAVA
--
-- O briefing (§14) pergunta taxa, fuso, telefone e cashback UMA vez, na
-- primeira entrada — e depois não havia nenhuma tela para mudar nada disso. Um
-- restaurante que decidisse ligar o cashback três meses depois não tinha por
-- onde. Era um sistema que só aceita ser configurado no dia em que nasce.
--
-- POR QUE FUNÇÃO, E NÃO UPDATE DIRETO
--
-- `restaurants_owner_update` já existe e deixaria o dono escrever direto. Mas
-- taxa de serviço e cashback são DINHEIRO: mexer neles muda o que o cliente
-- paga e o que a casa devolve, e este projeto tem uma regra sobre isso desde a
-- 0010 — toda decisão de dinheiro deixa rastro no `audit_log`.
--
-- A função também é onde os limites são reapertados. O CHECK da coluna
-- recusaria com um erro de banco; aqui o valor é simplesmente limitado, que é o
-- comportamento certo para quem digitou 200 sem querer.
-- =============================================================================

/**
 * Muda as configurações da casa.
 *
 * Campo ausente no jsonb é campo NÃO ALTERADO. Isso é deliberado: a tela pode
 * mandar só o que mexeu, e uma tela futura que esqueça um campo não o zera.
 *
 * SQLSTATEs:
 *   45110 sem permissão
 */
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
  -- `owner` e ponto. Taxa e cashback saem do bolso da casa; nem gerente mexe.
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
    'cor', brand_color
  ) into v_antes
  from public.restaurants where id = v_restaurante;

  update public.restaurants
     set name = coalesce(nullif(btrim(p_valores ->> 'nome'), ''), name),

         -- Os tetos, de novo e aqui: Server Action é endpoint público (§10.3), e
         -- o Zod da tela é a mensagem bonita, não a proteção.
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
           -- Cor só entra se for hexadecimal de verdade. Um valor inválido aqui
           -- não quebra o banco: quebra o `style` de toda tela da equipe, que é
           -- pior de diagnosticar.
           when p_valores ->> 'cor' ~ '^#[0-9A-Fa-f]{6}$'
             then p_valores ->> 'cor'
           else brand_color end
   where id = v_restaurante;

  select jsonb_build_object(
    'nome', name,
    'taxa_servico', service_fee_pct,
    'cashback', cashback_pct,
    'timezone', timezone,
    'pedir_telefone', require_phone,
    'cor', brand_color
  ) into v_depois
  from public.restaurants where id = v_restaurante;

  -- Só registra se ALGO mudou de fato. Auditoria cheia de linha idêntica é
  -- auditoria que ninguém lê.
  if v_antes is distinct from v_depois then
    insert into public.audit_log (
      restaurant_id, actor_type, actor_id, action, entity_type, entity_id,
      before, after
    ) values (
      v_restaurante, 'staff', auth.uid(), 'restaurant.settings_changed',
      'restaurants', v_restaurante, v_antes, v_depois
    );
  end if;

  return v_depois;
end;
$$;

revoke all on function public.atualizar_configuracoes(jsonb) from public, anon;
grant execute on function public.atualizar_configuracoes(jsonb) to authenticated;

comment on function public.atualizar_configuracoes(jsonb) is
  'Muda nome, taxa, cashback, fuso, telefone e cor da casa. Só o dono, e toda '
  'mudança vai para o audit_log. Campo ausente = campo não alterado.';
