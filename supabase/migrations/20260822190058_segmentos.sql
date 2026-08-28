-- =============================================================================
-- 0058 — Segmentos: falar com quem tem motivo
-- =============================================================================
-- Até aqui, campanha ia para TODO MUNDO que aceitou. Funciona, e é o caminho
-- mais rápido para queimar a lista: quem recebe três promoções que não têm nada
-- a ver com ele clica em "sair" na quarta — e sair é definitivo.
--
-- Quatro segmentos, e cada um responde a uma pergunta que o dono de restaurante
-- de fato faz:
--
--   todos       — "avisa a casa toda". Continua existindo, e continua sendo o
--                 certo para mudança de horário, feriado, evento grande.
--   com_saldo   — "quem tem dinheiro parado aqui?". O mais valioso dos quatro:
--                 essa pessoa já pagou por um motivo para voltar.
--   sumidos     — "quem parou de vir?". Só quem JÁ VEIO, sempre.
--   melhores    — "quem gasta mais?". Para o convite que não cabe a todo mundo.
--
-- O SEGMENTO FICA GRAVADO NA CAMPANHA
--
-- Não é um filtro que existe só no momento do clique. Fica em `segmento`,
-- jsonb, e por dois motivos: a tela precisa dizer DEPOIS para quem aquilo foi,
-- e remontar o público tem que dar o mesmo resultado.
--
-- E A CONTAGEM USA A MESMA FUNÇÃO DO ENVIO
--
-- A prévia — "isto vai para 47 pessoas" — e a montagem chamam
-- `app.publico_do_segmento`. Duas consultas parecidas divergiriam no primeiro
-- ajuste, e a divergência apareceria como a tela prometendo 47 e a fila
-- entregando 300.
--
-- QUANTO ALGUÉM GASTOU É UMA APROXIMAÇÃO, E ESTÁ DITO
--
-- O sistema não sabe quem comeu o quê: uma comanda de mesa tem vários
-- convivas. `melhores` soma o total das COMANDAS em que a pessoa esteve, que
-- superestima quem sempre vem acompanhado. É a mesma limitação que fez o
-- cashback ir para o primeiro cliente da mesa (0038), e a tela avisa em vez de
-- fingir precisão.
-- =============================================================================

alter table public.message_campaigns
  add column if not exists segmento jsonb not null default '{"tipo":"todos"}'::jsonb;

comment on column public.message_campaigns.segmento is
  'Para quem esta campanha foi montada. Gravado, e não só aplicado: a tela '
  'precisa dizer depois para quem aquilo foi.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campanhas_segmento_conhecido') then
    alter table public.message_campaigns
      add constraint campanhas_segmento_conhecido
      check (segmento ->> 'tipo' in ('todos', 'com_saldo', 'sumidos', 'melhores'));
  end if;
end $$;

-- =============================================================================
-- QUEM ESTÁ NO SEGMENTO
-- =============================================================================
-- Uma função, usada pela prévia E pela montagem. `security definer` porque lê
-- `phone` e o histórico de comandas, e devolve apenas IDS — nenhum dado
-- pessoal sai daqui.
-- =============================================================================
create or replace function app.publico_do_segmento(
  p_restaurante uuid,
  p_segmento    jsonb
) returns table (customer_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tipo text := coalesce(p_segmento ->> 'tipo', 'todos');
  v_dias int  := greatest(coalesce((p_segmento ->> 'dias')::int, 60), 1);
  v_min  int  := greatest(coalesce((p_segmento ->> 'min_cents')::int, 0), 0);
begin
  return query
  select c.id
    from public.customers c
   where c.restaurant_id = p_restaurante
     -- O consentimento é a base de TODOS os segmentos, sem exceção. Um
     -- segmento que o dispensasse seria uma porta lateral para a lista inteira.
     and app.aceita_marketing(c.marketing_opt_in_at, c.marketing_opt_out_at)
     and c.phone is not null
     and case v_tipo

       when 'todos' then true

       when 'com_saldo' then
         app.saldo_disponivel(c.id) >= greatest(v_min, 1)

       when 'sumidos' then
         -- Já veio, e não vem há v_dias. "Sentimos sua falta" para quem nunca
         -- apareceu é mentira, e soa como tal.
         exists (select 1 from public.session_guests g where g.customer_id = c.id)
         and not exists (
           select 1 from public.session_guests g
            where g.customer_id = c.id
              and g.joined_at > now() - (v_dias || ' days')::interval
         )

       when 'melhores' then
         coalesce((
           select sum(st.total_cents)
             from public.session_guests g
             join public.session_totals st on st.session_id = g.session_id
            where g.customer_id = c.id
              and g.joined_at > now() - (v_dias || ' days')::interval
         ), 0) >= greatest(v_min, 1)

       else false
     end;
end;
$$;

grant execute on function app.publico_do_segmento(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- A PRÉVIA: quantas pessoas, antes de montar nada.
--
-- É o número que faz alguém parar antes de clicar. Mandar para 12 é uma
-- decisão, mandar para 1.240 é outra, e sem a prévia o botão é o mesmo.
-- -----------------------------------------------------------------------------
create or replace function public.contar_segmento(p_segmento jsonb)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from app.publico_do_segmento(app.current_restaurant_id(), p_segmento);
$$;

grant execute on function public.contar_segmento(jsonb) to authenticated;

-- =============================================================================
-- MONTAR O PÚBLICO, AGORA COM SEGMENTO
-- =============================================================================
create or replace function public.montar_publico(
  p_campanha uuid,
  p_segmento jsonb default null
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid;
  v_corpo       text;
  v_status      text;
  v_seg         jsonb;
  v_n           int;
begin
  select c.restaurant_id, c.corpo, c.status, c.segmento
    into v_restaurante, v_corpo, v_status, v_seg
    from public.message_campaigns c
   where c.id = p_campanha
     and c.restaurant_id = app.current_restaurant_id();

  if v_restaurante is null then
    raise exception 'Campanha não encontrada' using errcode = '45120';
  end if;

  if not app.has_any_role('owner', 'manager') then
    raise exception 'Só dono ou gerente monta o público' using errcode = '42501';
  end if;

  if v_status <> 'draft' then
    raise exception 'O público só é montado antes de começar' using errcode = '45121';
  end if;

  -- Segmento novo grava na campanha; ausente reusa o que já estava. Assim
  -- "refazer a lista" sem escolher nada refaz A MESMA lista, em vez de
  -- silenciosamente virar "todos".
  if p_segmento is not null then
    v_seg := p_segmento;
    update public.message_campaigns set segmento = v_seg, updated_at = now()
     where id = p_campanha;
  end if;

  delete from public.message_campaign_targets where campaign_id = p_campanha;

  -- O TOKEN PRIMEIRO, E DEPOIS A MENSAGEM. Ver a 0050: gerar o token dentro do
  -- INSERT da mensagem e de novo na linha do cliente dá dois valores
  -- diferentes, e o link vai para o WhatsApp apontando para o nada.
  update public.customers
     set unsubscribe_token = app.generate_short_code(24)
   where restaurant_id = v_restaurante
     and unsubscribe_token is null
     and app.aceita_marketing(marketing_opt_in_at, marketing_opt_out_at)
     and phone is not null;

  insert into public.message_campaign_targets
    (restaurant_id, campaign_id, customer_id, message)
  select
    v_restaurante, p_campanha, c.id,
    app.render_mensagem(v_corpo, c.name, app.saldo_disponivel(c.id), c.unsubscribe_token)
  from public.customers c
  where c.id in (select s.customer_id from app.publico_do_segmento(v_restaurante, v_seg) s);

  get diagnostics v_n = row_count;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'staff', auth.uid(), 'campanha.publico', 'campaign', p_campanha,
     jsonb_build_object('destinatarios', v_n, 'segmento', v_seg));

  return v_n;
end;
$$;

grant execute on function public.montar_publico(uuid, jsonb) to authenticated;

-- A assinatura antiga sai de cena: deixá-la viva criaria DUAS funções chamáveis
-- por `rpc('montar_publico')`, e o PostgREST escolheria pelo formato do corpo —
-- o que faria "montar sem segmento" cair na versão velha, que ignora segmento
-- e monta para todo mundo. Uma campanha de nicho viraria disparo geral.
drop function if exists public.montar_publico(uuid);

-- -----------------------------------------------------------------------------
-- A view de progresso passa a dizer o segmento.
-- -----------------------------------------------------------------------------
create or replace view public.campanhas_com_progresso
with (security_invoker = true) as
  select
    c.id, c.restaurant_id, c.titulo, c.corpo, c.status, c.scheduled_at,
    c.next_send_at, c.started_at, c.finished_at, c.last_error, c.created_at,
    count(t.id)                                  as total,
    count(*) filter (where t.status = 'sent')    as enviados,
    count(*) filter (where t.status = 'pending') as pendentes,
    count(*) filter (where t.status = 'failed')  as falharam,
    count(*) filter (where t.status = 'skipped') as pulados,
    c.trigger_kind,
    c.segmento
  from public.message_campaigns c
  left join public.message_campaign_targets t on t.campaign_id = c.id
  group by c.id;

grant select on public.campanhas_com_progresso to authenticated;
