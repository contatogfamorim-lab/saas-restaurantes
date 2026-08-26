-- =============================================================================
-- 0040 — O briefing pergunta o percentual de cashback
-- =============================================================================
-- Migration própria, e não uma edição na 0034: aquela já rodou em produção, e
-- editá-la faria o repositório descrever algo que nunca aconteceu naquele banco.
--
-- `cashback` ausente na resposta mantém o valor atual em vez de zerar. Quem
-- responder o briefing de novo — a função é idempotente de propósito — não perde
-- a configuração por ter omitido a chave.
-- =============================================================================

create or replace function public.aplicar_briefing(p_respostas jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_restaurante uuid := app.current_restaurant_id();
  v_tipo text := p_respostas ->> 'tipo_cozinha';
  v_mesas int := least(greatest(coalesce((p_respostas ->> 'mesas')::int, 10), 1), 200);
  v_fuso text := coalesce(nullif(p_respostas ->> 'timezone', ''), 'America/Sao_Paulo');
  v_taxa numeric := coalesce((p_respostas ->> 'taxa_servico')::numeric, 10);
  v_cashback numeric := (p_respostas ->> 'cashback')::numeric;
  v_bloco jsonb;
  v_categoria uuid;
  v_item text;
  v_ordem int := 0;
  v_criadas int := 0;
  v_produtos int := 0;
begin
  if not app.has_any_role('owner') then
    raise exception 'Só quem administra o restaurante responde o briefing'
      using errcode = '45090';
  end if;

  update public.restaurants
     set timezone = v_fuso,
         service_fee_pct = least(greatest(v_taxa, 0), 30),
         require_phone = coalesce((p_respostas ->> 'pedir_telefone')::boolean, false),
         briefing_at = coalesce(briefing_at, now()),
         -- O teto de 20% é reapertado AQUI, e não só na tela: Server Action é
         -- endpoint público (§10.3), e o CHECK da coluna recusaria com um erro
         -- feio em vez de simplesmente limitar.
         cashback_pct = case
           when v_cashback is null then cashback_pct
           else least(greatest(v_cashback, 0), 20)
         end
   where id = v_restaurante;

  select greatest(0, v_mesas - count(*)) into v_criadas
    from public.restaurant_tables where restaurant_id = v_restaurante;

  if v_criadas > 0 then
    perform public.create_tables(v_criadas, 'Salão');
  end if;

  for v_bloco in select * from jsonb_array_elements(app.catalogo_por_cozinha(v_tipo))
  loop
    v_ordem := v_ordem + 1;

    select id into v_categoria
      from public.categories
     where restaurant_id = v_restaurante and name = (v_bloco ->> 'categoria');

    if not found then
      insert into public.categories (restaurant_id, name, sort_order, station)
      values (v_restaurante, v_bloco ->> 'categoria', v_ordem,
              (v_bloco ->> 'estacao')::public.station)
      returning id into v_categoria;
    end if;

    for v_item in select * from jsonb_array_elements_text(v_bloco -> 'itens')
    loop
      if not exists (
        select 1 from public.products
         where restaurant_id = v_restaurante and name = v_item
      ) then
        insert into public.products
          (restaurant_id, category_id, name, price_cents, is_available)
        values (v_restaurante, v_categoria, v_item, 0, false);
        v_produtos := v_produtos + 1;
      end if;
    end loop;
  end loop;

  insert into public.restaurant_briefing (restaurant_id, respostas)
  values (v_restaurante, p_respostas)
  on conflict (restaurant_id) do update
    set respostas = excluded.respostas,
        expires_at = now() + interval '3 hours';

  insert into public.audit_log (
    restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after
  ) values (
    v_restaurante, 'staff', auth.uid(), 'restaurant.briefing', 'restaurants',
    v_restaurante,
    jsonb_build_object('tipo_cozinha', v_tipo, 'mesas', v_mesas,
                       'produtos_criados', v_produtos, 'cashback', v_cashback)
  );

  return jsonb_build_object(
    'mesas_criadas', v_criadas,
    'produtos_criados', v_produtos
  );
end;
$$;

revoke all on function public.aplicar_briefing(jsonb) from public, anon;
grant execute on function public.aplicar_briefing(jsonb) to authenticated;
