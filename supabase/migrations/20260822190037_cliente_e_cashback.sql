-- =============================================================================
-- 0037 — Conta do cliente e cashback
-- =============================================================================
-- DOIS MODOS, E O VISITANTE CONTINUA SENDO O PADRÃO
--
-- Visitante: nome e telefone, como hoje. É `session_guests`, e nada muda — quem
-- só quer comer não deveria ter de criar conta em lugar nenhum.
--
-- Cadastro: CPF, celular, e-mail, nome e senha. Ganha cashback. É a tabela
-- `customers` desta migration, e ela é POR RESTAURANTE: o saldo é dinheiro
-- daquela casa, e o isolamento entre restaurantes é a regra que o projeto
-- inteiro sustenta. Duas casas com o mesmo CPF são dois clientes distintos, que
-- é o que o modelo já dizia sobre tudo o mais.
--
-- O QUE NÃO SAI DAQUI
--
-- `password_hash` não é concedido a NINGUÉM — nem `anon`, nem `authenticated`.
-- Só funções `security definer` o tocam. `cpf` segue o tratamento que o
-- telefone já tem desde a 0009: a coluna crua fica fora do GRANT e o que a
-- equipe enxerga é `cpf_mask`.
--
-- A REGRA DO RESGATE
--
-- Uma só, ainda que soe como duas: **o abatimento nunca passa de 30% da conta**.
-- É por isso que o saldo inteiro só é gasto numa compra 3,333…× maior que ele —
-- 100/30 = 3,333…. Não há mínimo, não há arredondamento a favor da casa que não
-- seja para baixo.
--
-- E o crédito só fica disponível 24 HORAS depois. Sem essa carência, o cliente
-- ganharia e gastaria no mesmo pagamento, e o cashback deixaria de ser motivo
-- para voltar — que é a única coisa que ele existe para ser.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quanto esta casa devolve. Zero = sem cashback, e é o padrão.
--
-- Teto de 20%: acima disso é quase certamente dedo errado no briefing, e um
-- valor absurdo aqui vira prejuízo silencioso a cada conta fechada.
-- -----------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists cashback_pct numeric(5,2) not null default 0
    check (cashback_pct >= 0 and cashback_pct <= 20);

comment on column public.restaurants.cashback_pct is
  'Percentual devolvido ao cliente cadastrado. 0 = recurso desligado.';

-- =============================================================================
-- A CONTA DO CLIENTE
-- =============================================================================
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,

  -- Só dígitos. Formatação é assunto de tela; no banco, CPF é onze algarismos —
  -- guardar "123.456.789-00" e "12345678900" como coisas diferentes é criar
  -- dois clientes para a mesma pessoa.
  cpf           text not null check (cpf ~ '^[0-9]{11}$'),
  name          text not null check (length(btrim(name)) between 2 and 80),
  phone         text,
  email         text,
  password_hash text not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- O CPF é único DENTRO da casa, não na plataforma.
  unique (restaurant_id, cpf)
);

-- Espelha `session_guests.phone_mask` (0009): a coluna crua fica fora do GRANT,
-- e o que a equipe lê é isto. Mostra os três dígitos do meio, que bastam para
-- conferir "é você mesmo?" no balcão, e escondem o resto.
alter table public.customers
  add column cpf_mask text generated always as
    ('•••.' || substr(cpf, 4, 3) || '.•••-••') stored;

alter table public.customers
  add column phone_mask text generated always as
    (case when phone is null then null else '•••••-' || right(phone, 4) end) stored;

create index customers_por_restaurante_idx on public.customers (restaurant_id);

alter table public.customers enable row level security;

-- A equipe lê os clientes da PRÓPRIA casa. E lê pelas colunas concedidas
-- abaixo: `cpf`, `phone` e `password_hash` não estão entre elas.
create policy customers_staff_read on public.customers
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

-- Ninguém escreve direto. Cadastro e troca de senha passam por função, que é
-- onde o hash é feito e onde o CPF é validado.
grant select (id, restaurant_id, name, email, cpf_mask, phone_mask,
              created_at, updated_at)
  on public.customers to authenticated;

-- `anon` não toca nesta tabela. O celular do cliente fala com ela por funções,
-- e quem chama as funções é o servidor do Next com a chave de serviço, depois
-- de validar o cookie assinado (§10.4).
revoke all on public.customers from anon;

-- E o GRANT que a chave de serviço precisa para LER a tabela.
--
-- Esqueci este e o do extrato na primeira versão, e o efeito foi pior que um
-- erro: a tela do cliente mostrava "nada por aqui ainda" com o saldo correto ao
-- lado — porque as funções são `security definer` e passavam, enquanto a
-- consulta à tabela era negada em silêncio. É a lição da 0013 outra vez, agora
-- do lado do `service_role`.
grant select on public.customers to service_role;

-- =============================================================================
-- O EXTRATO
-- =============================================================================
-- Saldo é SOMA DE LANÇAMENTOS, não um número guardado numa coluna.
--
-- A diferença aparece no dia em que o saldo estiver errado: com extrato,
-- dá para ver de onde veio cada centavo; com contador, só dá para acreditar. É
-- a mesma razão de o `audit_log` existir, aplicada a dinheiro do cliente.
-- =============================================================================
create type public.cashback_kind as enum ('credito', 'resgate');

create table public.customer_cashback_ledger (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  customer_id   uuid not null references public.customers(id) on delete restrict,
  session_id    uuid references public.table_sessions(id) on delete restrict,

  kind          public.cashback_kind not null,

  -- SEMPRE positivo. O sinal está no `kind`, e valor negativo num extrato é
  -- convite a somar errado — `sum(amount)` daria uma resposta plausível e falsa.
  amount_cents  integer not null check (amount_cents > 0),

  -- Crédito: nasce daqui a 24h. Resgate: vale na hora.
  available_at  timestamptz not null default now(),

  -- Como o valor foi obtido, para o extrato do cliente poder explicá-lo.
  base_cents    integer,
  pct           numeric(5,2),

  created_at    timestamptz not null default now()
);

create index cashback_por_cliente_idx
  on public.customer_cashback_ledger (customer_id, available_at);

-- UM CRÉDITO POR COMANDA, e a garantia é do armazenamento, não de um `if`.
--
-- `creditar_cashback` é chamada de dentro de `register_payment`, que roda com o
-- papel de quem está no caixa — então a função precisa ser executável por
-- `authenticated`, e o que é executável é chamável direto. Sem este índice,
-- repetir a chamada creditaria de novo, e o dinheiro sairia do bolso da casa a
-- cada repetição.
--
-- `session_id` nulo não colide: no Postgres, NULLs são distintos entre si num
-- índice único. É o que permite o crédito manual (ajuste, cortesia) conviver
-- com a regra.
create unique index cashback_um_credito_por_sessao
  on public.customer_cashback_ledger (session_id)
  where kind = 'credito';

alter table public.customer_cashback_ledger enable row level security;

create policy cashback_staff_read on public.customer_cashback_ledger
  for select to authenticated
  using (restaurant_id = app.current_restaurant_id());

grant select on public.customer_cashback_ledger to authenticated;
grant select on public.customer_cashback_ledger to service_role;
revoke all on public.customer_cashback_ledger from anon;

-- -----------------------------------------------------------------------------
-- O visitante que virou cliente.
--
-- `null` é o normal e continua sendo: a esmagadora maioria das comandas é de
-- gente que não quis conta nenhuma.
-- -----------------------------------------------------------------------------
alter table public.session_guests
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists session_guests_por_cliente_idx
  on public.session_guests (customer_id) where customer_id is not null;

grant select (customer_id) on public.session_guests to authenticated;

-- =============================================================================
-- O RESGATE VIRA UMA LINHA PRÓPRIA NA CONTA
-- =============================================================================
-- E NÃO um `discount` comum. A casa precisa distinguir "dei desconto" de
-- "cliente gastou o que já era dele": são linhas diferentes no resultado do mês,
-- e misturá-las faz o desconto concedido parecer maior do que foi.
-- =============================================================================
-- -----------------------------------------------------------------------------
-- `created_by` deixa de ser obrigatório — mas SÓ para o resgate.
--
-- A coluna era `not null` porque a tabela pressupunha que quem mexe na conta é
-- da equipe: todo desconto tem um nome atrás, e é assim que a auditoria
-- responde "quem autorizou isto?". O resgate de cashback quebra a premissa de
-- propósito — quem aplica é o CLIENTE, do próprio celular, e não existe
-- funcionário a quem atribuir.
--
-- O CHECK mantém a garantia onde ela importa: desconto e isenção de taxa
-- continuam exigindo um responsável. Trocar o `not null` por nada teria
-- afrouxado a regra para os três tipos de uma vez.
--
-- Quem resgatou não fica sem rastro: o extrato em `customer_cashback_ledger`
-- registra cliente e sessão, e o `audit_log` recebe `cashback.redeemed`.
-- -----------------------------------------------------------------------------
alter table public.session_adjustments alter column created_by drop not null;

-- O CHECK que completa esta regra está na 0038: ele cita `'cashback'`, e um
-- valor de enum não pode ser USADO na mesma transação em que é criado.

alter type public.adjustment_type add value if not exists 'cashback';
