-- =============================================================================
-- 0049 — Consentimento de marketing: a permissão que ainda não existe
-- =============================================================================
-- POR QUE ISTO VEM ANTES DO DISPARADOR
--
-- O sistema já guarda telefone de cliente. É tentador olhar para essa lista e
-- concluir que o CRM está pronto — falta só mandar a mensagem. Não está, e a
-- razão é o que a pessoa leu na hora de digitar o número:
--
--   "Autorizo {restaurante} a guardar meu telefone para contato SOBRE ESTE
--    PEDIDO."
--
-- Essa frase autoriza uma coisa e uma só. Mandar promoção para quem marcou
-- aquela caixa é usar o dado para finalidade diferente da informada — o que a
-- LGPD chama de tratamento sem base legal (art. 6º, I, e art. 9º, §2º), e o que
-- qualquer pessoa chamaria de quebra de combinado.
--
-- NINGUÉM É HERDADO
--
-- Esta migration não marca um único cliente existente como aceito. É a decisão
-- mais cara do arquivo: o banco de produção começa com uma lista de marketing
-- VAZIA, e ela só enche daqui para frente, uma pessoa por vez.
--
-- A alternativa — herdar quem já tinha telefone — trocaria uma base grande hoje
-- por uma base ilegal para sempre, e a conta chegaria na forma de denúncia à
-- ANPD, com o próprio banco de dados servindo de prova contra a casa: o
-- `consent_text` mostraria, com data e hora, que o texto aceito falava de outra
-- coisa.
--
-- O OPT-OUT SEMPRE GANHA, E `now()` NÃO SERVE DE DESEMPATE
--
-- A primeira versão desta migration guardava as duas datas e decidia por
-- comparação: está dentro se `opt_out < opt_in`. Parece exato, e tem um buraco
-- que o teste de "quem saiu pode voltar" encontrou na primeira execução.
--
-- `now()` no Postgres é o instante da TRANSAÇÃO, não do comando. Sair e voltar
-- na mesma transação grava a mesma data nas duas colunas, `opt_out < opt_in` dá
-- falso, e a pessoa que acabou de clicar em "aceito" fica fora da lista — com a
-- tela dizendo que deu certo. Silencioso, e sem ninguém para reclamar, porque a
-- pessoa acha que está inscrita.
--
-- Agora `marketing_opt_out_at` responde uma pergunta só — "está fora desde
-- quando?" — e aceitar de novo a limpa. Sem relógio no meio, sem empate.
--
-- A história não se perde: ela nunca esteve nessa coluna. Uma coluna só guarda
-- a ÚLTIMA saída de qualquer jeito. Quem guarda entrada e saída, todas, com
-- data, é o `audit_log` — que é imutável, e é o lugar certo para isso.
--
-- O LINK DE SAÍDA NÃO PODE SER UM GET
--
-- Ver `descadastrar_marketing`: o token abre uma PÁGINA, e a saída acontece no
-- botão. WhatsApp, iMessage e antivírus corporativo abrem links sozinhos para
-- montar a pré-visualização. Um `/sair/{token}` que dá baixa no próprio GET
-- descadastraria a pessoa antes de ela tocar em nada — e o dono do restaurante
-- veria a lista esvaziar sem nenhum cliente ter pedido isso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- As três colunas do consentimento, e o token de saída.
-- -----------------------------------------------------------------------------
alter table public.customers
  add column if not exists marketing_opt_in_at     timestamptz,
  add column if not exists marketing_opt_out_at    timestamptz,
  add column if not exists marketing_consent_text  text,
  add column if not exists unsubscribe_token       text;

comment on column public.customers.marketing_opt_in_at is
  'Quando a pessoa aceitou receber mensagens. NULL = nunca aceitou, e nunca '
  'entra em campanha. Não é preenchida por migração: só por ato do cliente.';

comment on column public.customers.marketing_opt_out_at is
  'Está fora desde quando. NULL = não está fora. Aceitar de novo limpa esta '
  'coluna; o histórico de entradas e saídas vive no audit_log, que é imutável.';

comment on column public.customers.marketing_consent_text is
  'O TEXTO EXATO que a pessoa leu ao aceitar. É a prova do que foi combinado. '
  'Se o restaurante muda a redação amanhã, o que valia ontem continua legível.';

comment on column public.customers.unsubscribe_token is
  'Segredo por cliente para o link "sair da lista", que funciona sem login. '
  'Aleatório, nunca sequencial: adivinhar um token é descadastrar um estranho.';

-- Guarda de integridade: aceite sem texto é aceite que não se pode provar.
--
-- É a diferença entre "ela consentiu" e "ela consentiu COM O QUÊ" — e só a
-- segunda serve de defesa. Sem esta restrição, qualquer código futuro que
-- escrevesse só a data criaria consentimento indefensável, em silêncio.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_consentimento_tem_texto'
  ) then
    alter table public.customers
      add constraint customers_consentimento_tem_texto
      check (marketing_opt_in_at is null or marketing_consent_text is not null);
  end if;
end $$;

create unique index if not exists customers_unsubscribe_token_idx
  on public.customers (unsubscribe_token) where unsubscribe_token is not null;

-- Índice do público: a pergunta que o disparador faz é sempre a mesma.
create index if not exists customers_marketing_ativo_idx
  on public.customers (restaurant_id, marketing_opt_in_at)
  where marketing_opt_in_at is not null;

-- O token não vai para `authenticated`. É segredo do cliente, não do
-- restaurante: quem tem o token descadastra aquela pessoa, e a equipe não
-- precisa dessa capacidade para nada.
revoke select (unsubscribe_token) on public.customers from authenticated;

-- =============================================================================
-- QUEM PODE RECEBER
-- =============================================================================
-- A regra em UM lugar. Espalhada por três consultas, uma delas esqueceria o
-- opt-out em algum refactor, e o erro apareceria como mensagem enviada para
-- quem pediu para não receber — que é o erro que não tem desfazer.
-- =============================================================================
create or replace function app.aceita_marketing(
  p_opt_in  timestamptz,
  p_opt_out timestamptz
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_opt_in is not null and p_opt_out is null;
$$;

comment on function app.aceita_marketing(timestamptz, timestamptz) is
  'Única definição de "pode receber campanha": aceitou e não está fora. Sem '
  'comparação de datas — ver o cabeçalho da 0049 sobre now() e o empate.';

grant execute on function app.aceita_marketing(timestamptz, timestamptz)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- O público, como a equipe o enxerga.
--
-- `security_invoker`: a view não empresta privilégio nenhum: quem consulta
-- atravessa a RLS de `customers` com o próprio crachá.
--
-- E o telefone sai MASCARADO, inclusive para o dono. A regra da 0037 continua
-- valendo aqui: não existe consulta que devolva uma lista de números inteiros.
-- O disparador não usa esta view — ele lê `customers` como `service_role`, um
-- destinatário por vez, no momento de enviar.
-- -----------------------------------------------------------------------------
create or replace view public.publico_de_marketing
with (security_invoker = true) as
  select
    c.id,
    c.restaurant_id,
    c.name,
    c.phone_mask,
    c.marketing_opt_in_at,
    c.marketing_consent_text
  from public.customers c
  where app.aceita_marketing(c.marketing_opt_in_at, c.marketing_opt_out_at)
    -- `phone_mask`, e não `phone`: a view é `security_invoker`, então quem
    -- consulta precisa de GRANT nas colunas que ela toca — inclusive nas do
    -- WHERE. Ler `phone` aqui daria "permission denied" na cara do dono, e a
    -- saída fácil (dar o GRANT) desfaria a proteção da 0037.
    --
    -- Equivalente por construção: `phone_mask` é coluna gerada e vale NULL
    -- exatamente quando `phone` é NULL.
    and c.phone_mask is not null;

comment on view public.publico_de_marketing is
  'Quem aceitou receber mensagem e tem telefone. Telefone mascarado — a view é '
  'para CONTAR e CONFERIR, não para exportar.';

grant select on public.publico_de_marketing to authenticated;

-- =============================================================================
-- O CLIENTE ACEITA
-- =============================================================================
-- `security definer` porque escreve em `customers`, onde `anon` não tem nada —
-- e é `anon` quem chama: o cliente na mesa não tem login no Supabase.
--
-- O texto vem do BANCO, não do parâmetro. Se o navegador mandasse a frase, o
-- consentimento provaria o que o cliente quisesse que provasse — inclusive uma
-- frase que nunca esteve na tela. O servidor não confia no cliente (§10.1), e
-- consentimento é o último lugar onde faria sentido abrir exceção.
-- =============================================================================
create or replace function public.aceitar_marketing(
  p_customer uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid;
  v_texto       text;
  v_ja          boolean;
begin
  select c.restaurant_id,
         app.aceita_marketing(c.marketing_opt_in_at, c.marketing_opt_out_at)
    into v_restaurante, v_ja
    from public.customers c
   where c.id = p_customer;

  if v_restaurante is null then
    -- Não digo "cliente não existe": isso transformaria a função em um
    -- oráculo de IDs válidos para quem chutasse.
    return false;
  end if;

  if v_ja then
    return true;  -- Idempotente: aceitar duas vezes não reescreve a data.
  end if;

  v_texto := app.texto_de_consentimento(v_restaurante);

  -- Aceitar LIMPA a saída. Um opt-in que deixasse `opt_out_at` preenchido
  -- dependeria de comparar as duas datas para decidir quem ganha — e é
  -- exatamente essa comparação que empata quando as duas caem na mesma
  -- transação.
  update public.customers
     set marketing_opt_in_at    = now(),
         marketing_opt_out_at   = null,
         marketing_consent_text = v_texto,
         unsubscribe_token      = coalesce(unsubscribe_token, app.generate_short_code(24)),
         updated_at             = now()
   where id = p_customer;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'guest', p_customer, 'marketing.opt_in', 'customer', p_customer,
     jsonb_build_object('texto', v_texto));

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- O texto que a casa mostra.
--
-- Fica no banco porque é ele que vai para `marketing_consent_text`, e as duas
-- coisas precisam ser a MESMA string. Uma frase no React e outra no INSERT
-- divergiriam no primeiro ajuste de copy, e a prova guardada passaria a
-- descrever uma tela que não existe mais.
-- -----------------------------------------------------------------------------
create or replace function app.texto_de_consentimento(p_restaurante uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select 'Aceito receber de ' || r.name ||
         ' mensagens no WhatsApp sobre meu cashback, promoções e eventos. ' ||
         'Posso sair quando quiser, pelo link no fim de cada mensagem.'
    from public.restaurants r
   where r.id = p_restaurante;
$$;

grant execute on function app.texto_de_consentimento(uuid)
  to anon, authenticated, service_role;
grant execute on function public.aceitar_marketing(uuid)
  to anon, authenticated, service_role;

-- =============================================================================
-- O CLIENTE SAI
-- =============================================================================
-- Duas funções de propósito, e a separação é a proteção:
--
--   `app.dono_do_token`  — só LÊ. É o que a página de saída chama no GET, para
--                          saber de que restaurante é o link e escrever o nome
--                          na tela. Não muda nada, então o robô de
--                          pré-visualização do WhatsApp pode abri-la à vontade.
--
--   `descadastrar_marketing` — ESCREVE. Só roda no clique.
--
-- Se fossem uma função só, a pré-visualização de link descadastraria a pessoa
-- que apenas RECEBEU a mensagem.
-- =============================================================================
create or replace function public.dono_do_token(p_token text)
returns table (restaurante text, nome text, ja_saiu boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.name,
         c.name,
         not app.aceita_marketing(c.marketing_opt_in_at, c.marketing_opt_out_at)
    from public.customers c
    join public.restaurants r on r.id = c.restaurant_id
   where c.unsubscribe_token = p_token
     and p_token is not null
     and length(p_token) >= 16;
$$;

create or replace function public.descadastrar_marketing(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid;
  v_restaurante uuid;
begin
  -- Piso de tamanho: sem isto, um `p_token` vazio ou curto casaria com qualquer
  -- linha que tivesse token nulo em algum caminho futuro.
  if p_token is null or length(p_token) < 16 then
    return false;
  end if;

  select c.id, c.restaurant_id
    into v_id, v_restaurante
    from public.customers c
   where c.unsubscribe_token = p_token;

  if v_id is null then
    return false;
  end if;

  -- Escreve mesmo em quem já tinha saído, e a auditoria registra as duas
  -- vezes: sair de novo é o gesto de quem recebeu mensagem DEPOIS de ter
  -- pedido para não receber, e essa repetição é a evidência do problema.
  update public.customers
     set marketing_opt_out_at = now(),
         updated_at           = now()
   where id = v_id;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'guest', v_id, 'marketing.opt_out', 'customer', v_id,
     jsonb_build_object('origem', 'link'));

  return true;
end;
$$;

grant execute on function public.dono_do_token(text)          to anon, authenticated, service_role;
grant execute on function public.descadastrar_marketing(text) to anon, authenticated, service_role;

-- =============================================================================
-- A EQUIPE TIRA ALGUÉM DA LISTA
-- =============================================================================
-- O cliente pede no balcão, por telefone, ou grita da mesa. Sem este caminho a
-- equipe só teria a saída errada: apagar o cadastro — o que levaria junto o
-- cashback da pessoa.
--
-- E a equipe NÃO tem o caminho inverso. Não existe `aceitar_marketing` para
-- staff: consentimento dado por outra pessoa não é consentimento, e um botão
-- "marcar como aceito" no painel seria usado em lote no primeiro dia lento.
-- =============================================================================
create or replace function public.remover_do_marketing(p_customer uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurante uuid;
begin
  if not app.has_any_role('owner', 'manager') then
    raise exception 'Só dono ou gerente tira alguém da lista' using errcode = '42501';
  end if;

  select c.restaurant_id into v_restaurante
    from public.customers c
   where c.id = p_customer
     and c.restaurant_id = app.current_restaurant_id();

  if v_restaurante is null then
    raise exception 'Cliente não encontrado' using errcode = '45110';
  end if;

  update public.customers
     set marketing_opt_out_at = now(), updated_at = now()
   where id = p_customer;

  insert into public.audit_log
    (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  values
    (v_restaurante, 'staff', auth.uid(), 'marketing.opt_out', 'customer', p_customer,
     jsonb_build_object('origem', 'equipe'));

  return true;
end;
$$;

grant execute on function public.remover_do_marketing(uuid) to authenticated;

-- =============================================================================
-- OS GRANTS DAS COLUNAS NOVAS
-- =============================================================================
-- `customers` tem privilégio por COLUNA desde a 0037, e não por tabela. Coluna
-- criada depois nasce sem grant nenhum: o `alter table` acima não herda nada.
--
-- Sem estas linhas a tela de clientes quebraria com "permission denied for
-- table customers" — a mesma pegadinha da 0013 e da 0034, agora pela porta da
-- coluna em vez da porta da tabela. Fica listado explicitamente para que a
-- ausência de `unsubscribe_token` aqui seja LEGÍVEL como decisão, e não como
-- esquecimento.
-- =============================================================================
grant select (marketing_opt_in_at, marketing_opt_out_at, marketing_consent_text)
  on public.customers to authenticated;

grant select (marketing_opt_in_at, marketing_opt_out_at, marketing_consent_text,
              unsubscribe_token)
  on public.customers to service_role;
