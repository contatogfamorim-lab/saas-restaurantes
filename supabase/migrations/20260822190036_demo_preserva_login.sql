-- =============================================================================
-- 0036 — A demonstração apaga o restaurante, não o login
-- =============================================================================
-- O QUE MUDOU DE IDEIA
--
-- A 0034 apagava `auth.users` junto com a demonstração vencida, e o raciocínio
-- escrito lá era: conta viva com restaurante morto dá um login que entra num
-- sistema sem perfil, sem mesa e sem cardápio.
--
-- Está errado, e o que revelou o erro foi o projeto ligar a confirmação de
-- e-mail em produção. Quem gera a demonstração gera em cima da PRÓPRIA conta,
-- com o e-mail dela — agora já confirmado, ao custo de um ida-e-volta na caixa
-- de entrada. Apagá-la cobra esse pedágio uma segunda vez exatamente de quem
-- gostou do sistema e voltou para montar o restaurante de verdade.
--
-- E o estado que sobra não é o descrito acima: sem PERFIL, `getStaff()` devolve
-- nulo e `/comecar` põe a pessoa no passo "criar restaurante" — que é
-- precisamente o lugar certo para quem tem login e ainda não tem casa. O wizard
-- já sabia tratar isso desde a §14; eu é que não tinha percebido.
--
-- Não acumula: linha em `auth.users` não custa quota, e conta que não loga não
-- conta como usuário ativo no plano free.
--
-- POR QUE UMA MIGRATION NOVA, E NÃO UMA EDIÇÃO NA 0034
--
-- A 0034 já rodou em produção. Editá-la faria o arquivo do repositório descrever
-- algo que nunca aconteceu naquele banco, e o próximo `db push` não a
-- reaplicaria — a correção simplesmente não chegaria lá. Migration é registro do
-- que aconteceu, não lista de desejos.
-- =============================================================================

create or replace function app.limpar_demos_vencidas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_qtd int;
begin
  -- As RESPOSTAS vencem em 3 horas mesmo em restaurante de verdade: elas já
  -- viraram categoria, produto e mesa, e guardar cidade e porte da casa depois
  -- disso é acumular dado de alguém sem uso. `briefing_at` fica; a resposta sai.
  delete from public.restaurant_briefing where expires_at < now();

  select array_agg(id) into v_ids
    from public.restaurants
   where expires_at is not null and expires_at < now();

  if v_ids is null then return 0; end if;
  v_qtd := array_length(v_ids, 1);

  delete from public.order_item_modifiers where restaurant_id = any(v_ids);
  delete from public.order_items          where restaurant_id = any(v_ids);
  delete from public.orders               where restaurant_id = any(v_ids);
  delete from public.payments             where restaurant_id = any(v_ids);
  delete from public.session_adjustments  where restaurant_id = any(v_ids);
  delete from public.waiter_calls         where restaurant_id = any(v_ids);
  delete from public.session_guests       where restaurant_id = any(v_ids);
  delete from public.table_sessions       where restaurant_id = any(v_ids);
  delete from public.menu_blocks          where restaurant_id = any(v_ids);
  delete from public.menu_layouts         where restaurant_id = any(v_ids);
  delete from public.menu_events          where restaurant_id = any(v_ids);
  delete from public.promotion_targets    where restaurant_id = any(v_ids);
  delete from public.promotions           where restaurant_id = any(v_ids);
  delete from public.product_modifier_groups where restaurant_id = any(v_ids);
  delete from public.modifier_options     where restaurant_id = any(v_ids);
  delete from public.modifier_groups      where restaurant_id = any(v_ids);
  delete from public.products             where restaurant_id = any(v_ids);
  delete from public.categories           where restaurant_id = any(v_ids);
  delete from public.restaurant_tables    where restaurant_id = any(v_ids);
  delete from public.restaurant_briefing  where restaurant_id = any(v_ids);
  delete from public.audit_log            where restaurant_id = any(v_ids);

  -- O PERFIL sai. A CONTA DE LOGIN fica — é a mudança desta migration, e o
  -- cabeçalho acima explica por quê.
  delete from public.profiles where restaurant_id = any(v_ids);

  delete from public.restaurants where id = any(v_ids);

  return v_qtd;
end;
$$;

revoke all on function app.limpar_demos_vencidas() from public, anon, authenticated;
grant execute on function app.limpar_demos_vencidas() to service_role;

comment on function app.limpar_demos_vencidas() is
  'Apaga as demonstrações vencidas: restaurante, pedidos, mesas e perfil. '
  'A conta de login sobrevive, para a pessoa montar o restaurante real depois.';
