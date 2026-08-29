-- =============================================================================
-- 0062 — Conversas e contatos do WhatsApp
-- =============================================================================
-- Portado do markello CRM (`app/api/webhooks/evolution`, `components/leads/
-- ChatPanel`), adaptado para multi-inquilino.
--
-- A REGRA QUE NÃO PODE SER FURADA
--
-- Contato puxado da Evolution é a AGENDA DO CELULAR. Aquelas pessoas nunca
-- autorizaram receber promoção — muitas nem são clientes, são o fornecedor de
-- carne e a sogra do dono. A base de marketing deste sistema (0049) é montada
-- por opt-in explícito, e `publico_de_marketing` só enxerga `customers` com
-- `marketing_opt_in_at` preenchido.
--
-- Por isso contato de WhatsApp mora em TABELA PRÓPRIA, e não em `customers`.
-- Não é organização: é o que torna o furo IMPOSSÍVEL em vez de improvável. Uma
-- coluna `origem` dentro de `customers` dependeria de todo `select` futuro
-- lembrar de filtrar por ela; uma tabela separada não depende de ninguém
-- lembrar de nada.
--
-- Quem quiser transformar um contato em cliente de verdade passa pelo cadastro,
-- que é onde a pessoa marca o aceite.
-- =============================================================================

-- ── CONTATOS ────────────────────────────────────────────────────────────────
create table public.whatsapp_contacts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,

  -- O identificador do WhatsApp (`5511999999999@s.whatsapp.net`). É a chave de
  -- verdade: o telefone dá para derivar dele, o contrário nem sempre.
  jid            text not null check (length(jid) between 5 and 128),
  phone          text check (phone ~ '^[0-9]{8,15}$'),
  nome           text check (length(btrim(nome)) between 1 and 120),
  foto_url       text,

  -- Quando a Evolution mandou pela última vez. Serve para a tela dizer se a
  -- agenda está velha.
  visto_em       timestamptz not null default now(),
  created_at     timestamptz not null default now(),

  unique (restaurant_id, jid)
);

create index whatsapp_contacts_por_casa on public.whatsapp_contacts (restaurant_id, nome);
create index whatsapp_contacts_por_fone on public.whatsapp_contacts (restaurant_id, phone);

-- ── MENSAGENS ───────────────────────────────────────────────────────────────
create table public.whatsapp_messages (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,

  -- A conversa é identificada pelo JID, e não por um id de contato: mensagem de
  -- número que não está na agenda tem que aparecer do mesmo jeito. O contato é
  -- enriquecimento, não pré-requisito.
  jid            text not null check (length(jid) between 5 and 128),

  -- `entrada` = o cliente mandou. `saida` = a casa mandou.
  direcao        text not null check (direcao in ('entrada', 'saida')),
  corpo          text not null check (length(corpo) between 1 and 4096),

  -- Áudio, imagem e documento ainda NÃO são baixados: o corpo guarda `[audio]`
  -- e a tela mostra assim. Meia implementação de mídia seria pior — a conversa
  -- pareceria completa e não estaria.
  tipo_midia     text check (tipo_midia in ('image', 'audio', 'video', 'document', 'sticker')),

  -- O id da Evolution, para o MESSAGES_UPDATE achar a linha e para o webhook
  -- ser idempotente: a Evolution reentrega o mesmo evento quando o nosso
  -- endpoint demora a responder.
  wa_id          text,
  status         text not null default 'recebida'
                   check (status in ('recebida', 'pendente', 'enviada', 'entregue', 'lida', 'erro')),

  -- O relógio DA MENSAGEM, que vem da Evolution. `created_at` é o relógio de
  -- quando gravamos, e os dois divergem quando o webhook atrasa ou quando o
  -- histórico chega em lote no pareamento.
  enviada_em     timestamptz not null default now(),
  lida_em        timestamptz,
  created_at     timestamptz not null default now(),

  unique (restaurant_id, wa_id)
);

create index whatsapp_messages_conversa
  on public.whatsapp_messages (restaurant_id, jid, enviada_em desc);
create index whatsapp_messages_nao_lidas
  on public.whatsapp_messages (restaurant_id, jid)
  where direcao = 'entrada' and lida_em is null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_messages enable row level security;

-- Ler é de quem já administra campanhas: é a mesma base de pessoas, e o número
-- do cliente é dado pessoal (§10.9). Garçom não abre a caixa de entrada da casa.
create policy contatos_da_casa on public.whatsapp_contacts
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'));

create policy conversas_da_casa on public.whatsapp_messages
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id() and app.has_any_role('owner', 'manager'));

-- ESCRITA NENHUMA pelo navegador.
--
-- Quem grava é o webhook, com `service_role`, e a ação de enviar, que grava
-- pela função abaixo. Uma policy de `insert` aqui deixaria a tela forjar uma
-- mensagem "recebida" do cliente — e a conversa é registro do que aconteceu.
--
-- Sem policy de insert/update/delete, a RLS recusa por omissão.

-- GRANTs: policy sem grant não abre nada (lição da 0043).
grant select on public.whatsapp_contacts to authenticated;
grant select on public.whatsapp_messages to authenticated;

/*
 * E O `service_role` TAMBÉM PRECISA DE GRANT.
 *
 * Ele ignora RLS, e é fácil concluir daí que ignora permissão de tabela — não
 * ignora. Sem estas linhas o webhook recebe o evento, tenta gravar, leva
 * "permission denied" e responde 200 assim mesmo, porque é o que ele deve
 * fazer com erro (a Evolution reentregaria para sempre).
 *
 * O resultado é o pior defeito que esta funcionalidade pode ter: a conexão diz
 * "conectado", a conversa acontece no celular, a tela fica vazia, e não há
 * nada na cara de ninguém dizendo o que houve. Foi assim que descobri —
 * mandando um evento de mentira para o endereço local e olhando o banco.
 *
 * `delete` NÃO entra: nem o webhook apaga conversa.
 */
grant select, insert, update on public.whatsapp_contacts to service_role;
grant select, insert, update on public.whatsapp_messages to service_role;

-- ── A LISTA DE CONVERSAS ────────────────────────────────────────────────────
--
-- Uma linha por JID, com a última mensagem e quantas não foram lidas. Montar
-- isso no cliente exigiria baixar a conversa inteira de todo mundo.
create view public.conversas_do_whatsapp
with (security_invoker = true) as
select
  m.restaurant_id,
  m.jid,
  c.nome,
  c.foto_url,
  c.phone,
  max(m.enviada_em)                                                  as ultima_em,
  (array_agg(m.corpo order by m.enviada_em desc))[1]                 as ultimo_corpo,
  (array_agg(m.direcao order by m.enviada_em desc))[1]               as ultima_direcao,
  count(*) filter (where m.direcao = 'entrada' and m.lida_em is null) as nao_lidas,
  count(*)                                                            as total
from public.whatsapp_messages m
left join public.whatsapp_contacts c
  on c.restaurant_id = m.restaurant_id and c.jid = m.jid
group by m.restaurant_id, m.jid, c.nome, c.foto_url, c.phone;

grant select on public.conversas_do_whatsapp to authenticated;

comment on view public.conversas_do_whatsapp is
  'Uma linha por conversa, com a última mensagem e o total de não lidas. '
  '`security_invoker` para a RLS das tabelas de base continuar valendo.';

comment on table public.whatsapp_contacts is
  'A agenda do aparelho, puxada da Evolution. NÃO é base de marketing: '
  'estas pessoas não autorizaram nada. Ver o cabeçalho da 0062.';

-- ── MARCAR COMO LIDA ────────────────────────────────────────────────────────
--
-- A única escrita que o navegador pode fazer, e ainda assim por função: um
-- `update` direto exigiria policy de update na tabela, e essa policy serviria
-- para reescrever `corpo` também.
create or replace function public.marcar_conversa_lida(p_jid text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_casa uuid := app.current_restaurant_id();
  v_qtd  int;
begin
  if v_casa is null or not app.has_any_role('owner', 'manager') then
    raise exception 'Sem permissão para ler as conversas da casa'
      using errcode = '45130';
  end if;

  update public.whatsapp_messages
     set lida_em = now()
   where restaurant_id = v_casa
     and jid = p_jid
     and direcao = 'entrada'
     and lida_em is null;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke all on function public.marcar_conversa_lida(text) from public, anon;
grant execute on function public.marcar_conversa_lida(text) to authenticated;

-- ── A CASA DE UMA INSTÂNCIA ─────────────────────────────────────────────────
--
-- O webhook chega sem sessão e com um nome de instância. Precisa descobrir de
-- quem é — e `restaurants` não é legível por `anon`.
--
-- Fica em `public` porque o PostgREST só enxerga esse schema (lição da 0050), e
-- `service_role` é o único que executa.
create or replace function public.casa_da_instancia(p_instancia text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.restaurants
   where evolution_instance_name = p_instancia
   limit 1;
$$;

revoke all on function public.casa_da_instancia(text) from public, anon, authenticated;
grant execute on function public.casa_da_instancia(text) to service_role;
