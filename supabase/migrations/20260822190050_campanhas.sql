-- =============================================================================
-- 0050 — Campanhas: a fila de mensagens, e o que ela recusa a fazer
-- =============================================================================
-- Portado do `crm_beta_final`, que já roda em produção há tempo. O desenho da
-- fila vem de lá inteiro, porque já pagou o pedágio: intervalo sorteado entre
-- as mensagens, ordem embaralhada e GRAVADA, vaga reservada antes do envio,
-- uma campanha por locatário a cada rodada.
--
-- O QUE MUDA, E POR QUÊ
--
-- 1. CONSENTIMENTO RECONFERIDO NA HORA DE ENVIAR
--
--    O CRM de origem não tinha esse conceito: o público era montado e enviado.
--    Aqui, entre montar a campanha e a mensagem sair podem passar horas, e
--    nesse meio a pessoa pode ter clicado em "sair da lista".
--
--    Conferir só na montagem mandaria mensagem para quem pediu para não
--    receber — e o pedido de saída estaria registrado, com hora, ANTES do
--    envio. É o pior registro possível de se ter.
--
--    Por isso a conferência mora em `public.reservar_proximo_envio`, em SQL, e não
--    no TypeScript que chama. Código de aplicação se contorna; esta função é o
--    único caminho que devolve um telefone.
--
-- 2. O TELEFONE NÃO É COPIADO PARA A FILA
--
--    O CRM guardava `phone` na linha do destinatário. Fazer isso aqui criaria
--    uma tabela com todos os números em texto puro, legível pelo dono — e
--    desfaria a 0037, que revogou a coluna `phone` para a equipe inteira.
--
--    A fila guarda `customer_id`. O número é resolvido no instante do envio,
--    por `service_role`, e não fica em lugar nenhum que a equipe leia.
--
-- 3. O LINK DE SAÍDA É COLADO PELO BANCO
--
--    Não é campo do formulário, nem lembrete na tela. Quem escreve a campanha
--    não tem como esquecer, porque não tem como incluir: `app.render_mensagem`
--    acrescenta o link sempre, e é ela que congela o texto.
--
-- 4. TETO DIÁRIO
--
--    O intervalo entre mensagens controla o RITMO. Não controla o VOLUME — e é
--    volume que faz um número ser bloqueado. Duzentas mensagens a 65 segundos
--    ainda são duzentas mensagens do mesmo número no mesmo dia.
--
-- O TEXTO É CONGELADO POR DESTINATÁRIO
--
-- Igual ao preço no pedido (§16). A mensagem é renderizada e gravada quando o
-- público é montado; editar a campanha depois não reescreve o que já foi
-- enviado. Sem isso, o registro mostraria o texto ATUAL para todo mundo, e
-- ninguém saberia o que a pessoa de fato recebeu.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A conexão do WhatsApp, por restaurante.
--
-- Servidor da Evolution é um só, em variável de ambiente. O que muda por casa é
-- o nome da instância — o "aparelho" ligado àquele número.
--
-- Sem instância configurada não há envio, e é assim que deve ser: uma casa que
-- ainda não conectou o WhatsApp não pode ter campanha saindo pelo número de
-- outra.
-- -----------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists evolution_instance_name text,
  add column if not exists marketing_max_por_dia   int not null default 200;

comment on column public.restaurants.evolution_instance_name is
  'Nome da instância na Evolution API. NULL = WhatsApp não conectado, e nenhuma '
  'campanha sai.';

comment on column public.restaurants.marketing_max_por_dia is
  'Teto de mensagens por dia. O intervalo entre envios controla o ritmo; este '
  'número controla o volume, que é o que derruba um número de WhatsApp.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_teto_diario_sensato') then
    alter table public.restaurants
      add constraint restaurants_teto_diario_sensato
      check (marketing_max_por_dia between 0 and 2000);
  end if;
end $$;

-- =============================================================================
-- AS DUAS TABELAS
-- =============================================================================
create table if not exists public.message_campaigns (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  created_by     uuid references public.profiles(id) on delete set null,

  titulo         text not null,
  corpo          text not null,

  -- draft    — escrita, público ainda não montado ou não iniciada
  -- sending  — na fila, o worker está mandando
  -- paused   — o dono parou no meio; retomar mantém a ordem
  -- done     — não sobrou destinatário pendente
  -- canceled — parada em definitivo; o que não saiu não sai mais
  status         text not null default 'draft',

  scheduled_at   timestamptz,
  next_send_at   timestamptz,
  started_at     timestamptz,
  finished_at    timestamptz,
  last_error     text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  check (status in ('draft', 'sending', 'paused', 'done', 'canceled')),
  check (length(btrim(titulo)) between 2 and 80),
  -- Teto de tamanho: o texto vai para o WhatsApp, e uma mensagem gigante é
  -- lida como spam pela pessoa antes de ser lida como spam pelo algoritmo.
  check (length(btrim(corpo)) between 10 and 900)
);

create table if not exists public.message_campaign_targets (
  id             uuid primary key default gen_random_uuid(),

  -- `restaurant_id` repetido de propósito: a policy de RLS precisa decidir sem
  -- fazer join. Join em policy é o caminho conhecido para a policy que parece
  -- certa e não filtra nada.
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  campaign_id    uuid not null references public.message_campaigns(id) on delete cascade,
  customer_id    uuid not null references public.customers(id) on delete cascade,

  -- CONGELADO. Ver o cabeçalho: é o mesmo princípio do preço no pedido.
  message        text not null,

  -- pending | sending | sent | failed | skipped
  --
  -- `skipped` é o estado que este sistema tem e o CRM de origem não tinha:
  -- "havia como mandar, e o sistema decidiu não mandar". Quem saiu da lista
  -- entre a montagem e o envio cai aqui, com o motivo — e a linha fica, porque
  -- apagar esconderia justamente a decisão que interessa numa auditoria.
  status         text not null default 'pending',
  motivo         text,

  send_order     int,
  sent_at        timestamptz,
  error_message  text,
  created_at     timestamptz not null default now(),

  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'))
);

-- Uma pessoa não recebe a mesma campanha duas vezes. É um índice, e não uma
-- checagem no código, porque duas montagens simultâneas passariam pela
-- checagem e o banco é o único lugar onde a corrida não existe.
create unique index if not exists campaign_targets_uma_vez_idx
  on public.message_campaign_targets (campaign_id, customer_id);

-- A busca do worker: pendentes de UMA campanha, em ordem.
create index if not exists campaign_targets_fila_idx
  on public.message_campaign_targets (campaign_id, send_order)
  where status = 'pending';

-- O teto diário: quantas saíram hoje nesta casa.
create index if not exists campaign_targets_enviados_idx
  on public.message_campaign_targets (restaurant_id, sent_at)
  where status = 'sent';

create index if not exists campaigns_fila_idx
  on public.message_campaigns (restaurant_id, next_send_at)
  where status = 'sending';

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.message_campaigns        enable row level security;
alter table public.message_campaign_targets enable row level security;

-- Leitura para quem já vê a gestão. Escrita só por dono e gerente: campanha é
-- a voz da casa falando com o cliente, e não é o garçom quem decide o que ela
-- diz.
create policy campanhas_leitura on public.message_campaigns
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

create policy campanhas_escrita on public.message_campaigns
  for all to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'))
  with check (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'));

create policy alvos_leitura on public.message_campaign_targets
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

-- Os destinatários NÃO são escritos pela equipe, nem pelo dono.
--
-- Quem monta a fila é `montar_publico`, que confere consentimento e congela o
-- texto. Um INSERT à mão poderia acrescentar um telefone que nunca autorizou
-- nada — e a fila é o último lugar antes do envio, então o que entra aqui sai.
--
-- A ausência de policy de escrita é a decisão. Está escrita para não parecer
-- esquecimento.
grant select on public.message_campaigns        to authenticated;
grant insert, update, delete on public.message_campaigns to authenticated;
grant select on public.message_campaign_targets to authenticated;

grant select, insert, update, delete on public.message_campaigns        to service_role;
grant select, insert, update, delete on public.message_campaign_targets to service_role;

-- -----------------------------------------------------------------------------
-- O endereço público do sistema.
--
-- Em uma tabela e não em `current_setting`, porque o worker e o site rodam em
-- processos diferentes e o link precisa ser o MESMO nos dois. Um link montado
-- com o host errado é um link de saída que não funciona — e um link de saída
-- que não funciona é pior que nenhum, porque a pessoa tenta e desiste.
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  chave text primary key,
  valor text not null
);

alter table public.app_settings enable row level security;

-- A RECUSA, ESCRITA.
--
-- A primeira versão apenas ligava a RLS e não escrevia policy nenhuma —
-- achando que o silêncio bastava, já que sem policy ninguém passa. O
-- `pnpm db:check-rls` reprovou, e estava certo: "RLS ligada, zero policies" é
-- exatamente o que se vê quando alguém ESQUECEU a policy. As duas situações
-- são indistinguíveis olhando o banco, e a perigosa é a comum.
--
-- `using (false)` diz a mesma coisa de forma legível: ninguém lê isto pela
-- porta pública. É configuração da instalação, não dado de locatário; quem
-- precisa são as funções `security definer`, que passam por cima da RLS.
--
-- E o `revoke` abaixo é o cinto além do suspensório: sem GRANT, o PostgREST
-- nem chega a avaliar a policy.
create policy app_settings_ninguem on public.app_settings
  for all to anon, authenticated
  using (false) with check (false);

revoke all on public.app_settings from anon, authenticated;

comment on table public.app_settings is
  'Configuração da instalação (não de restaurante). Fechada de propósito: a '
  'policy nega a todos, e só funções security definer leem daqui.';

insert into public.app_settings (chave, valor)
values ('url_base', 'http://localhost:3000')
on conflict (chave) do nothing;

create or replace function app.url_base()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select valor from public.app_settings where chave = 'url_base'),
    'http://localhost:3000'
  );
$$;

-- =============================================================================
-- O TEXTO
-- =============================================================================
-- Duas substituições, e só. `{nome}` e `{saldo}` são o que o caso de uso pede:
-- avisar que o cashback liberou. Uma linguagem de template completa aqui seria
-- uma superfície de injeção apontada para o WhatsApp de clientes reais.
--
-- E o link de saída, que não é opcional.
-- =============================================================================
create or replace function app.render_mensagem(
  p_corpo    text,
  p_nome     text,
  p_saldo    int,
  p_token    text
) returns text
language sql
-- `stable`, e não `immutable`: ela lê `app_settings` através de `url_base()`.
-- Declarar imutável seria autorizar o planejador a guardar o resultado em um
-- índice — e o dia em que o endereço da instalação mudasse, os links gravados
-- continuariam apontando para o antigo.
stable
set search_path = ''
as $$
  select replace(
           replace(p_corpo, '{nome}', coalesce(split_part(btrim(p_nome), ' ', 1), '')),
           '{saldo}',
           -- `G` e `D` seguem o `lc_numeric` do servidor, que aqui é C: davam
           -- "R$ .00" para saldo zero, sem o dígito e com ponto decimal. Vírgula
           -- e ponto LITERAIS no molde não dependem de locale nenhum, e o `0`
           -- antes do separador força o dígito que o `FM` estava comendo.
           --
           -- O molde produz 1,234.56 (à americana); as duas trocas seguintes
           -- viram 1.234,56, que é como se escreve dinheiro em português.
           'R$ ' || translate(
                      to_char(p_saldo / 100.0, 'FM999,999,990.00'),
                      ',.', '.,')
         )
         -- O link, sempre. Ver o cabeçalho da 0050: quem escreve a campanha não
         -- tem como esquecer porque não tem como incluir.
         || E'\n\nPara não receber mais: ' || app.url_base() || '/sair/' || p_token;
$$;

-- =============================================================================
-- MONTAR O PÚBLICO
-- =============================================================================
-- Aqui o consentimento é conferido a PRIMEIRA vez. A segunda é no envio, e é a
-- que vale — mas conferir aqui evita montar uma fila de mil pessoas para
-- descobrir na hora que novecentas não autorizaram.
-- =============================================================================
create or replace function public.montar_publico(p_campanha uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid;
  v_corpo       text;
  v_status      text;
  v_n           int;
begin
  select c.restaurant_id, c.corpo, c.status
    into v_restaurante, v_corpo, v_status
    from public.message_campaigns c
   where c.id = p_campanha
     and c.restaurant_id = app.current_restaurant_id();

  if v_restaurante is null then
    raise exception 'Campanha não encontrada' using errcode = '45120';
  end if;

  if not app.has_any_role('owner', 'manager') then
    raise exception 'Só dono ou gerente monta o público' using errcode = '42501';
  end if;

  -- Remontar uma campanha que já saiu reenviaria para quem já recebeu, e o
  -- índice único faria a operação inteira falhar no meio. Melhor recusar com
  -- uma frase do que falhar com uma violação de chave.
  if v_status <> 'draft' then
    raise exception 'O público só é montado antes de começar' using errcode = '45121';
  end if;

  delete from public.message_campaign_targets where campaign_id = p_campanha;

  -- O TOKEN PRIMEIRO, E DEPOIS A MENSAGEM. A ordem é o conserto de um bug.
  --
  -- A primeira versão fazia `coalesce(unsubscribe_token, generate_short_code())`
  -- dentro do INSERT da mensagem, e gravava o token no cliente logo em seguida
  -- — com uma segunda chamada ao gerador. Dois sorteios, dois valores
  -- diferentes: o link ia bonito para o WhatsApp e apontava para um token que
  -- o banco não conhecia. A pessoa clicava em "sair", via "Link inválido", e
  -- continuava recebendo.
  update public.customers
     set unsubscribe_token = app.generate_short_code(24)
   where restaurant_id = v_restaurante
     and unsubscribe_token is null
     and app.aceita_marketing(marketing_opt_in_at, marketing_opt_out_at)
     and phone is not null;

  insert into public.message_campaign_targets
    (restaurant_id, campaign_id, customer_id, message)
  select
    v_restaurante,
    p_campanha,
    c.id,
    app.render_mensagem(
      v_corpo,
      c.name,
      app.saldo_disponivel(c.id),
      -- Já existe: o UPDATE acima garantiu. Sem `coalesce` de propósito — se
      -- vier nulo, o `not null` de `message` derruba a montagem inteira, que é
      -- melhor que mandar mensagem com link quebrado.
      c.unsubscribe_token
    )
  from public.customers c
  where c.restaurant_id = v_restaurante
    and app.aceita_marketing(c.marketing_opt_in_at, c.marketing_opt_out_at)
    and c.phone is not null;

  get diagnostics v_n = row_count;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'staff', auth.uid(), 'campanha.publico', 'campaign', p_campanha,
     jsonb_build_object('destinatarios', v_n));

  return v_n;
end;
$$;

grant execute on function public.montar_publico(uuid) to authenticated;

-- =============================================================================
-- COMEÇAR, PAUSAR, CANCELAR
-- =============================================================================
create or replace function public.iniciar_campanha(
  p_campanha uuid,
  p_quando   timestamptz default null
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid;
  v_status      text;
  v_n           int;
begin
  select c.restaurant_id, c.status into v_restaurante, v_status
    from public.message_campaigns c
   where c.id = p_campanha and c.restaurant_id = app.current_restaurant_id();

  if v_restaurante is null then
    raise exception 'Campanha não encontrada' using errcode = '45120';
  end if;
  if not app.has_any_role('owner', 'manager') then
    raise exception 'Só dono ou gerente dispara campanha' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'paused') then
    raise exception 'Esta campanha não está parada' using errcode = '45122';
  end if;

  select count(*) into v_n from public.message_campaign_targets
   where campaign_id = p_campanha and status = 'pending';

  if v_n = 0 then
    raise exception 'Não há ninguém para receber. Monte o público antes.'
      using errcode = '45123';
  end if;

  if not exists (
    select 1 from public.restaurants r
     where r.id = v_restaurante and r.evolution_instance_name is not null
  ) then
    raise exception 'Conecte o WhatsApp antes de disparar' using errcode = '45124';
  end if;

  -- A ordem é sorteada e GRAVADA.
  --
  -- No CRM de origem isso era um `Promise.all` de N updates, um por
  -- destinatário: mil pessoas, mil idas ao banco. Aqui é um UPDATE só.
  --
  -- E a ordem precisa ficar gravada, não ser sorteada na hora de enviar: quem
  -- manda é o worker, uma mensagem por vez, e sem ordem persistida "aleatório"
  -- viraria a ordem de inserção — que é a ordem do cadastro dos clientes.
  --
  -- Só reordena quem está em `draft`. Retomar uma pausa mantém a fila: sortear
  -- de novo mandaria para o fim quem já estava quase sendo chamado.
  if v_status = 'draft' then
    with sorteio as (
      select id, row_number() over (order by random()) as ordem
        from public.message_campaign_targets
       where campaign_id = p_campanha and status = 'pending'
    )
    update public.message_campaign_targets t
       set send_order = s.ordem
      from sorteio s
     where t.id = s.id;
  end if;

  update public.message_campaigns
     set status       = case when p_quando is null then 'sending' else 'draft' end,
         scheduled_at = p_quando,
         -- A primeira sai já; o intervalo vale ENTRE uma e outra.
         next_send_at = case when p_quando is null then now() else null end,
         started_at   = coalesce(started_at, case when p_quando is null then now() end),
         finished_at  = null,
         last_error   = null,
         updated_at   = now()
   where id = p_campanha;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'staff', auth.uid(), 'campanha.iniciar', 'campaign', p_campanha,
     jsonb_build_object('destinatarios', v_n, 'agendada_para', p_quando));

  return v_n;
end;
$$;

create or replace function public.parar_campanha(
  p_campanha uuid,
  p_definitivo boolean default false
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid;
begin
  select c.restaurant_id into v_restaurante
    from public.message_campaigns c
   where c.id = p_campanha and c.restaurant_id = app.current_restaurant_id();

  if v_restaurante is null then
    raise exception 'Campanha não encontrada' using errcode = '45120';
  end if;
  if not app.has_any_role('owner', 'manager') then
    raise exception 'Só dono ou gerente para campanha' using errcode = '42501';
  end if;

  update public.message_campaigns
     set status       = case when p_definitivo then 'canceled' else 'paused' end,
         next_send_at = null,
         finished_at  = case when p_definitivo then now() end,
         updated_at   = now()
   where id = p_campanha
     and status in ('draft', 'sending', 'paused');

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'staff', auth.uid(),
     case when p_definitivo then 'campanha.cancelar' else 'campanha.pausar' end,
     'campaign', p_campanha, '{}'::jsonb);

  return true;
end;
$$;

grant execute on function public.iniciar_campanha(uuid, timestamptz) to authenticated;
grant execute on function public.parar_campanha(uuid, boolean)       to authenticated;

-- =============================================================================
-- A RESERVA — o coração do worker
-- =============================================================================
-- Uma função, uma transação, e é o ÚNICO caminho que devolve um telefone.
--
-- MORA EM `public`, E NÃO EM `app`, POR UM MOTIVO CHATO E DECISIVO
--
-- O PostgREST só enxerga o schema `public`. Uma função em `app` não é
-- chamável por `rpc()` — e as três funções do worker seriam escritas,
-- testadas, e falhariam no primeiro disparo de verdade com "função não
-- encontrada", já em produção.
--
-- Estar em `public` NÃO afrouxa nada: o que protege não é o schema, é o
-- GRANT. Logo abaixo, `revoke all from public, anon, authenticated` e
-- `grant execute to service_role`. Quem chegar pela porta pública recebe a
-- mesma recusa que receberia se a função não existisse.
--
-- O que ela faz, em ordem:
--
--   1. tranca UMA campanha pronta desta casa, com `skip locked`. Dois ticks
--      sobrepostos — worker reiniciado, chamada duplicada — pegariam o mesmo
--      destinatário, e a pessoa receberia a mesma mensagem duas vezes;
--   2. reserva a próxima vaga ANTES de enviar, pelo mesmo motivo;
--   3. confere o teto do dia;
--   4. anda pela fila pulando quem saiu da lista, marcando cada um como
--      `skipped` com o motivo;
--   5. devolve telefone e texto de UM destinatário.
--
-- O passo 4 é o que separa este sistema do CRM de origem. Se cinquenta pessoas
-- saíram desde a montagem, a rodada não pode voltar vazia — ela pula as
-- cinquenta e entrega a quinquagésima primeira.
-- =============================================================================
create or replace function public.reservar_proximo_envio()
returns table (
  campanha    uuid,
  alvo        uuid,
  restaurante uuid,
  instancia   text,
  telefone    text,
  mensagem    text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_camp   record;
  v_alvo   record;
  v_atraso interval;
  v_hoje   int;
begin
  -- Uma campanha por restaurante por rodada: duas campanhas da mesma casa
  -- usam a MESMA instância da Evolution, e mandar as duas juntas dobraria o
  -- ritmo daquele número — anulando o intervalo que existe para protegê-lo.
  select c.* into v_camp
    from public.message_campaigns c
   where c.status = 'sending'
     and (c.next_send_at is null or c.next_send_at <= now())
   order by c.next_send_at nulls first
   for update skip locked
   limit 1;

  if v_camp.id is null then
    return;
  end if;

  -- O intervalo: 40 a 90 segundos, pela média de dois sorteios.
  --
  -- A média de dois sorteios (triangular) agrupa perto de 65s e rareia os
  -- extremos, que é como pausa humana se distribui. Uniforme cairia em 40s e
  -- em 90s na mesma frequência — que é o que um script faz.
  --
  -- E sem arredondar para segundo cheio: 47s/62s/51s é assinatura de robô,
  -- 47,382s/61,907s/50,114s não é.
  v_atraso := (40 + ((random() + random()) / 2) * 50) * interval '1 second';

  update public.message_campaigns
     set next_send_at = now() + v_atraso, updated_at = now()
   where id = v_camp.id;

  -- O teto do dia, contado no fuso da casa: "hoje" para um restaurante que
  -- fecha às 2h da manhã não é o "hoje" do UTC.
  select count(*) into v_hoje
    from public.message_campaign_targets t
    join public.restaurants r on r.id = t.restaurant_id
   where t.restaurant_id = v_camp.restaurant_id
     and t.status = 'sent'
     and (t.sent_at at time zone r.timezone)::date
       = (now() at time zone r.timezone)::date;

  if v_hoje >= (select r.marketing_max_por_dia
                  from public.restaurants r where r.id = v_camp.restaurant_id) then
    -- Não é erro, e não cancela nada: a campanha continua e o worker volta
    -- amanhã. Falhar aqui marcaria destinatários como `failed` por um limite
    -- que é nosso, não deles.
    update public.message_campaigns
       set next_send_at = now() + interval '30 minutes',
           last_error   = 'Teto de mensagens do dia atingido'
     where id = v_camp.id;
    return;
  end if;

  -- Anda pela fila até achar alguém que ainda aceita.
  loop
    select t.* into v_alvo
      from public.message_campaign_targets t
     where t.campaign_id = v_camp.id and t.status = 'pending'
     order by t.send_order nulls last, t.created_at
     limit 1;

    if v_alvo.id is null then
      -- Acabou a fila. Fecha agora em vez de esperar mais um intervalo à toa.
      update public.message_campaigns
         set status = 'done', finished_at = now(), next_send_at = null, updated_at = now()
       where id = v_camp.id;
      return;
    end if;

    -- A SEGUNDA conferência de consentimento, e a que vale.
    if exists (
      select 1 from public.customers c
       where c.id = v_alvo.customer_id
         and app.aceita_marketing(c.marketing_opt_in_at, c.marketing_opt_out_at)
         and c.phone is not null
    ) then
      exit;
    end if;

    update public.message_campaign_targets
       set status = 'skipped',
           motivo = 'saiu da lista antes do envio'
     where id = v_alvo.id;
  end loop;

  update public.message_campaign_targets
     set status = 'sending'
   where id = v_alvo.id;

  return query
    select v_camp.id,
           v_alvo.id,
           v_camp.restaurant_id,
           r.evolution_instance_name,
           c.phone,
           v_alvo.message
      from public.customers c
      join public.restaurants r on r.id = v_camp.restaurant_id
     where c.id = v_alvo.customer_id;
end;
$$;

-- Só o worker. `authenticated` NÃO recebe: esta função devolve telefone em
-- texto puro, e dá-la à equipe seria abrir pela porta dos fundos a lista que a
-- 0037 fechou pela porta da frente.
revoke all on function public.reservar_proximo_envio() from public, anon, authenticated;
grant execute on function public.reservar_proximo_envio() to service_role;

-- -----------------------------------------------------------------------------
-- O desfecho de cada envio.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_envio(
  p_alvo  uuid,
  p_ok    boolean,
  p_erro  text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_camp uuid;
begin
  update public.message_campaign_targets
     set status        = case when p_ok then 'sent' else 'failed' end,
         sent_at       = case when p_ok then now() end,
         error_message = case when p_ok then null else p_erro end
   where id = p_alvo and status = 'sending'
  returning campaign_id into v_camp;

  if v_camp is null then
    return false;
  end if;

  if not p_ok then
    update public.message_campaigns set last_error = p_erro, updated_at = now()
     where id = v_camp;
  end if;

  -- Era o último? Fecha agora, em vez de esperar mais um intervalo à toa.
  if not exists (
    select 1 from public.message_campaign_targets
     where campaign_id = v_camp and status = 'pending'
  ) then
    update public.message_campaigns
       set status = 'done', finished_at = now(), next_send_at = null, updated_at = now()
     where id = v_camp;
  end if;

  return true;
end;
$$;

revoke all on function public.concluir_envio(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.concluir_envio(uuid, boolean, text) to service_role;

-- -----------------------------------------------------------------------------
-- Agendamento vencido entra na fila.
--
-- No CRM de origem isto dependia da tela estar aberta na hora marcada, e
-- agendar de noite para a manhã seguinte simplesmente não funcionava.
-- -----------------------------------------------------------------------------
create or replace function public.promover_agendadas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.message_campaigns
     set status = 'sending', next_send_at = now(), scheduled_at = null, updated_at = now(),
         started_at = coalesce(started_at, now())
   where status = 'draft'
     and scheduled_at is not null
     and scheduled_at <= now()
     and exists (select 1 from public.message_campaign_targets t
                  where t.campaign_id = message_campaigns.id and t.status = 'pending');

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.promover_agendadas() from public, anon, authenticated;
grant execute on function public.promover_agendadas() to service_role;

-- -----------------------------------------------------------------------------
-- O painel: como vai cada campanha.
--
-- `security_invoker`, então atravessa a RLS com o crachá de quem consulta. Sem
-- telefone nenhum: contagem é o que a tela precisa.
-- -----------------------------------------------------------------------------
create or replace view public.campanhas_com_progresso
with (security_invoker = true) as
  select
    c.id,
    c.restaurant_id,
    c.titulo,
    c.corpo,
    c.status,
    c.scheduled_at,
    c.next_send_at,
    c.started_at,
    c.finished_at,
    c.last_error,
    c.created_at,
    count(t.id)                                          as total,
    count(*) filter (where t.status = 'sent')            as enviados,
    count(*) filter (where t.status = 'pending')         as pendentes,
    count(*) filter (where t.status = 'failed')          as falharam,
    count(*) filter (where t.status = 'skipped')         as pulados
  from public.message_campaigns c
  left join public.message_campaign_targets t on t.campaign_id = c.id
  group by c.id;

grant select on public.campanhas_com_progresso to authenticated;

-- -----------------------------------------------------------------------------
-- A faxina das demonstrações precisa saber destas tabelas.
--
-- Ela descobre as tabelas sozinha desde a 0044, olhando o
-- `information_schema` por coluna `restaurant_id`. As duas tabelas novas têm
-- essa coluna, então entram sem alteração — este comentário existe para que a
-- próxima pessoa não procure por uma lista que não existe mais.
-- -----------------------------------------------------------------------------
