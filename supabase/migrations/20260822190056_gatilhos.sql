-- =============================================================================
-- 0056 — Gatilhos automáticos
-- =============================================================================
-- Três motivos para o sistema falar com o cliente sem ninguém mandar:
--
--   liberou   — o cashback saiu da carência e já pode ser usado. É o aviso mais
--               honesto que existe aqui: a pessoa tem dinheiro parado na casa e
--               não sabe;
--   vai_expirar — o saldo tem data para sumir e ela está perto. Avisar é
--               obrigação de quem vai tirar; não avisar e depois expirar é o
--               tipo de coisa que faz alguém nunca mais voltar;
--   sumido    — não aparece há N dias. O único dos três que é marketing puro, e
--               por isso o mais fácil de exagerar.
--
-- ELES NÃO TÊM CAMINHO PRÓPRIO DE ENVIO
--
-- Esta é a decisão que segura tudo. Um gatilho não manda mensagem: ele CRIA
-- CAMPANHA, e a campanha passa pela fila da 0050 como qualquer outra.
--
-- Isso não é reaproveitamento por preguiça. A fila é onde moram o intervalo de
-- 40 a 90 segundos, o teto diário, a reconferência de consentimento no instante
-- do envio e o link de saída colado pelo banco. Um segundo caminho de envio
-- teria que reimplementar os quatro — e o dia em que um deles fosse esquecido,
-- o sistema mandaria mensagem para quem pediu para não receber, sem intervalo,
-- sem teto e sem como sair.
--
-- O QUE IMPEDE O EXAGERO
--
-- Automático sem freio é o que transforma "avisos úteis" em "aquele
-- restaurante que enche o saco". Três freios:
--
--   1. IDEMPOTÊNCIA POR EVENTO. Cada disparo carrega uma referência estável —
--      `liberou:<id do crédito>`, `sumido:<cliente>:<mês>`. Índice único. A
--      mesma pessoa não recebe duas vezes pelo mesmo motivo, nunca, nem que o
--      job rode mil vezes.
--
--   2. TETO POR PESSOA. Quantas mensagens automáticas uma pessoa aguenta por
--      mês. O teto diário da 0050 protege o NÚMERO da casa; este protege a
--      PACIÊNCIA de quem recebe, que é o que de fato se perde primeiro.
--
--   3. CADA GATILHO É DESLIGÁVEL, e todos nascem DESLIGADOS. Um sistema que
--      começa mandando mensagem sozinho é um sistema que mandou mensagem que
--      ninguém autorizou — mesmo com consentimento de marketing dado, porque o
--      dono também não pediu.
-- =============================================================================

alter table public.restaurants
  add column if not exists marketing_max_por_cliente_mes int not null default 4;

comment on column public.restaurants.marketing_max_por_cliente_mes is
  'Quantas mensagens automáticas uma pessoa recebe por mês. O teto diário '
  'protege o número da casa; este protege a paciência de quem recebe.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_teto_pessoa_sensato') then
    alter table public.restaurants
      add constraint restaurants_teto_pessoa_sensato
      check (marketing_max_por_cliente_mes between 0 and 30);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Os gatilhos, um por tipo por casa.
-- -----------------------------------------------------------------------------
create table if not exists public.message_triggers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,

  kind           text not null,
  -- NASCE DESLIGADO. Ver o cabeçalho: começar ligado é mandar mensagem que
  -- ninguém pediu.
  ativo          boolean not null default false,
  corpo          text not null,

  -- Parâmetro do tipo. Hoje só `sumido` usa: quantos dias sem aparecer.
  dias           int not null default 60,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  check (kind in ('liberou', 'vai_expirar', 'sumido')),
  check (length(btrim(corpo)) between 10 and 900),
  check (dias between 1 and 3650)
);

create unique index if not exists message_triggers_um_por_tipo_idx
  on public.message_triggers (restaurant_id, kind);

alter table public.message_triggers enable row level security;

create policy gatilhos_leitura on public.message_triggers
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

create policy gatilhos_escrita on public.message_triggers
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'));

grant select, insert, update, delete on public.message_triggers to authenticated;
grant select, insert, update, delete on public.message_triggers to service_role;

-- -----------------------------------------------------------------------------
-- A referência do evento: o que impede a repetição.
-- -----------------------------------------------------------------------------
alter table public.message_campaign_targets
  add column if not exists trigger_ref text;

comment on column public.message_campaign_targets.trigger_ref is
  'Identifica o EVENTO que gerou este disparo — "liberou:<id do crédito>", '
  '"sumido:<cliente>:<mês>". Único por restaurante: a mesma pessoa nunca '
  'recebe duas vezes pelo mesmo motivo.';

-- O índice é a garantia, e não uma checagem no código: dois jobs sobrepostos
-- passariam pela checagem e a pessoa receberia duas vezes.
create unique index if not exists campaign_targets_um_por_evento_idx
  on public.message_campaign_targets (restaurant_id, customer_id, trigger_ref)
  where trigger_ref is not null;

alter table public.message_campaigns
  add column if not exists trigger_kind text;

comment on column public.message_campaigns.trigger_kind is
  'Qual gatilho criou esta campanha. NULL = escrita por uma pessoa.';

-- =============================================================================
-- QUANTAS MENSAGENS AUTOMÁTICAS ESTA PESSOA JÁ RECEBEU ESTE MÊS
-- =============================================================================
create or replace function app.automaticas_no_mes(p_cliente uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int
    from public.message_campaign_targets t
    join public.message_campaigns c on c.id = t.campaign_id
   where t.customer_id = p_cliente
     and c.trigger_kind is not null
     and t.status = 'sent'
     and t.sent_at > now() - interval '30 days';
$$;

-- =============================================================================
-- A CAMPANHA DO DIA, POR GATILHO
-- =============================================================================
-- Uma campanha por gatilho por dia, e não uma por pessoa. Mil clientes
-- liberando cashback no mesmo dia viram mil DESTINATÁRIOS de uma campanha, não
-- mil campanhas — a fila escolhe uma campanha por casa por rodada, então mil
-- campanhas fariam as 999 restantes esperarem indefinidamente.
-- =============================================================================
create or replace function app.campanha_do_gatilho(
  p_restaurante uuid,
  p_kind        text,
  p_corpo       text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_hoje  date;
  v_fuso  text;
begin
  select r.timezone into v_fuso from public.restaurants r where r.id = p_restaurante;
  v_hoje := (now() at time zone coalesce(v_fuso, 'America/Sao_Paulo'))::date;

  select c.id into v_id
    from public.message_campaigns c
   where c.restaurant_id = p_restaurante
     and c.trigger_kind = p_kind
     and c.status in ('draft', 'sending')
     and (c.created_at at time zone coalesce(v_fuso, 'America/Sao_Paulo'))::date = v_hoje
   limit 1;

  if v_id is not null then return v_id; end if;

  insert into public.message_campaigns
    (restaurant_id, titulo, corpo, status, trigger_kind, next_send_at, started_at)
  values
    (p_restaurante,
     case p_kind
       when 'liberou'     then 'Cashback liberado · ' || to_char(v_hoje, 'DD/MM')
       when 'vai_expirar' then 'Cashback expirando · ' || to_char(v_hoje, 'DD/MM')
       else                    'Sentimos sua falta · ' || to_char(v_hoje, 'DD/MM')
     end,
     p_corpo, 'sending', p_kind, now(), now())
  returning id into v_id;

  return v_id;
end;
$$;

-- =============================================================================
-- PÔR UMA PESSOA NA FILA, SE ELA COUBER
-- =============================================================================
-- Todos os freios ficam AQUI, num lugar só. Cada gatilho novo que alguém
-- escrever passa por esta função ou não entra na fila.
-- =============================================================================
create or replace function app.enfileirar_do_gatilho(
  p_restaurante uuid,
  p_cliente     uuid,
  p_kind        text,
  p_corpo       text,
  p_ref         text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campanha uuid;
  v_teto     int;
  v_cli      record;
begin
  select c.name, c.unsubscribe_token,
         app.aceita_marketing(c.marketing_opt_in_at, c.marketing_opt_out_at) as aceita,
         c.phone is not null as tem_fone
    into v_cli
    from public.customers c where c.id = p_cliente;

  -- Consentimento, de novo. A fila reconfere no envio, e conferir aqui evita
  -- encher a fila de gente que vai ser pulada.
  if v_cli is null or not v_cli.aceita or not v_cli.tem_fone then
    return false;
  end if;

  select r.marketing_max_por_cliente_mes into v_teto
    from public.restaurants r where r.id = p_restaurante;

  if app.automaticas_no_mes(p_cliente) >= coalesce(v_teto, 4) then
    return false;
  end if;

  -- Sem token não há link de saída, e sem link de saída não sai mensagem.
  if v_cli.unsubscribe_token is null then
    update public.customers set unsubscribe_token = app.generate_short_code(24)
     where id = p_cliente;
    select c.unsubscribe_token into v_cli.unsubscribe_token
      from public.customers c where c.id = p_cliente;
  end if;

  v_campanha := app.campanha_do_gatilho(p_restaurante, p_kind, p_corpo);

  begin
    insert into public.message_campaign_targets
      (restaurant_id, campaign_id, customer_id, message, trigger_ref, send_order)
    values
      (p_restaurante, v_campanha, p_cliente,
       app.render_mensagem(p_corpo, v_cli.name,
                           app.saldo_disponivel(p_cliente), v_cli.unsubscribe_token),
       p_ref,
       -- Ordem de chegada. Sortear aqui não faria sentido: cada pessoa entra
       -- num momento diferente, e a fila já é imprevisível por natureza.
       (select coalesce(max(send_order), 0) + 1
          from public.message_campaign_targets where campaign_id = v_campanha));
  exception
    when unique_violation then
      -- Já foi avisada por este evento. É o caso NORMAL de um job que roda de
      -- hora em hora, não um erro.
      return false;
  end;

  return true;
end;
$$;

-- =============================================================================
-- OS TRÊS GATILHOS
-- =============================================================================
create or replace function public.rodar_gatilhos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g    record;
  v_alvo record;
  v_n    int;
  v_out  jsonb := '{}'::jsonb;
begin
  for v_g in
    select t.* from public.message_triggers t
     join public.restaurants r on r.id = t.restaurant_id
    where t.ativo
      and r.active
      and r.evolution_instance_name is not null
      -- Demonstração não manda mensagem para ninguém. O restaurante some em 3
      -- horas; o WhatsApp de quem recebeu, não.
      and r.expires_at is null
  loop
    v_n := 0;

    if v_g.kind = 'liberou' then
      -- Crédito que ACABOU de sair da carência. A janela de 2 dias existe
      -- porque o job pode ficar parado; sem ela, uma queda de algumas horas
      -- faria a casa perder o aviso de todo mundo daquele dia.
      for v_alvo in
        select l.customer_id, 'liberou:' || l.id::text as ref
          from public.customer_cashback_ledger l
         where l.restaurant_id = v_g.restaurant_id
           and l.kind = 'credito'
           and l.available_at <= now()
           and l.available_at > now() - interval '2 days'
      loop
        if app.enfileirar_do_gatilho(v_g.restaurant_id, v_alvo.customer_id,
                                     v_g.kind, v_g.corpo, v_alvo.ref) then
          v_n := v_n + 1;
        end if;
      end loop;

    elsif v_g.kind = 'vai_expirar' then
      -- Sete dias de antecedência: perto o bastante para ser urgente, longe o
      -- bastante para caber um jantar no meio.
      --
      -- A condição é SÓ a data. A primeira versão exigia também
      -- `cashback_a_caducar > 0`, e as duas coisas se excluem: enquanto o saldo
      -- está DENTRO da validade nada caducou ainda, então `a_caducar` é zero —
      -- e no dia em que deixa de ser zero, já foi. O aviso nunca sairia.
      --
      -- `cashback_caduca_em` já devolve nulo quando não há validade ou não há
      -- saldo, então a data sozinha diz tudo o que precisa ser dito.
      for v_alvo in
        select c.id as customer_id,
               'expira:' || c.id::text || ':' ||
                 to_char(app.cashback_caduca_em(c.id), 'YYYYMMDD') as ref
          from public.customers c
         where c.restaurant_id = v_g.restaurant_id
           and app.cashback_caduca_em(c.id) between now() and now() + interval '7 days'
      loop
        if app.enfileirar_do_gatilho(v_g.restaurant_id, v_alvo.customer_id,
                                     v_g.kind, v_g.corpo, v_alvo.ref) then
          v_n := v_n + 1;
        end if;
      end loop;

    elsif v_g.kind = 'sumido' then
      -- A referência leva o MÊS: quem sumiu continua sumido amanhã, e sem isso
      -- receberia o mesmo "sentimos sua falta" todos os dias até voltar.
      for v_alvo in
        select c.id as customer_id,
               'sumido:' || c.id::text || ':' || to_char(now(), 'YYYYMM') as ref
          from public.customers c
         where c.restaurant_id = v_g.restaurant_id
           and exists (
             -- Só quem JÁ VEIO. "Sentimos sua falta" para quem nunca apareceu
             -- é mentira, e soa como tal.
             select 1 from public.session_guests g
              where g.customer_id = c.id
           )
           and not exists (
             select 1 from public.session_guests g
              where g.customer_id = c.id
                and g.joined_at > now() - (v_g.dias || ' days')::interval
           )
      loop
        if app.enfileirar_do_gatilho(v_g.restaurant_id, v_alvo.customer_id,
                                     v_g.kind, v_g.corpo, v_alvo.ref) then
          v_n := v_n + 1;
        end if;
      end loop;
    end if;

    v_out := v_out || jsonb_build_object(v_g.kind, coalesce((v_out ->> v_g.kind)::int, 0) + v_n);
  end loop;

  return v_out;
end;
$$;

revoke all on function public.rodar_gatilhos() from public, anon, authenticated;
grant execute on function public.rodar_gatilhos() to service_role;

-- -----------------------------------------------------------------------------
-- Os textos de fábrica.
--
-- Existem para a tela não abrir com uma caixa vazia e a pergunta "e agora, o
-- que eu escrevo?". São ponto de partida, e a tela diz isso.
-- -----------------------------------------------------------------------------
create or replace function app.corpo_padrao_do_gatilho(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'liberou' then
      'Oi {nome}! Seu cashback de {saldo} já está liberado para usar. Te esperamos 😊'
    when 'vai_expirar' then
      -- Diz "parte do", e não "seu cashback de {saldo} vai expirar": só o mais
      -- antigo caduca na data, e prometer o número errado é pior que não
      -- mandar. {saldo} é o que ela TEM, que é verdade sem exceção.
      'Oi {nome}, parte do seu cashback está perto de expirar. Você tem {saldo} para usar — vem aproveitar!'
    else
      'Oi {nome}, faz tempo que você não aparece — e a gente sentiu falta. Vem tomar um café por nossa conta?'
  end;
$$;

grant execute on function app.corpo_padrao_do_gatilho(text) to authenticated, service_role;
