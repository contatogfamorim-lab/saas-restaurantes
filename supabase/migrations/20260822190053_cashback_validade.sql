-- =============================================================================
-- 0053 — Carência e validade do cashback, definidas pela casa
-- =============================================================================
-- A 0038 fixou 24 horas de carência no código. Foi a decisão certa para nascer,
-- e errada para durar: uma hamburgueria de bairro quer o saldo valendo rápido,
-- e uma casa noturna que enche aos sábados quer segurar até o próximo fim de
-- semana. Nenhuma das duas devia precisar de deploy para isso.
--
-- SÃO DUAS COISAS DIFERENTES, E O SISTEMA PRECISA SABER DISSO
--
--   CARÊNCIA  — quanto tempo até o saldo PODER ser usado. Existe para o
--               cashback não virar desconto imediato, que é outro produto.
--   VALIDADE  — quanto tempo até o saldo SUMIR. Zero = nunca some, e é o
--               padrão: uma casa que não escolheu não deve tirar nada de
--               ninguém por omissão.
--
-- COMO O SALDO EXPIRA SEM PUNIR QUEM GASTOU
--
-- O jeito ingênuo — "não contar crédito velho" — está errado, e erra contra o
-- cliente. Imagine crédito antigo de R$ 100, crédito novo de R$ 50, e um
-- resgate de R$ 80 feito quando os dois valiam. O saldo real é R$ 70. Ignorar
-- o crédito velho daria 50 − 80 = −30, que vira zero: a pessoa perderia os
-- R$ 50 novos por ter gastado os antigos.
--
-- O certo é entender que RESGATE CONSOME O MAIS VELHO PRIMEIRO. Então o que
-- caduca é só o que sobrou de velho:
--
--   caducou = maior(0, saldo_atual − créditos_dentro_da_validade)
--
-- No exemplo: 70 − 50 = 20 caducam, e os 50 novos ficam. Que é o correto.
--
-- E a expiração vira UMA LINHA no extrato, com valor e data. O saldo continua
-- sendo a soma dos lançamentos, sem regra escondida em consulta — e o cliente
-- consegue ver o que perdeu, que é o mínimo antes de tirar algo de alguém.
-- =============================================================================

-- =============================================================================
-- ESTE ARQUIVO FAZ POUCO, E A DIVISÃO É O CONTEÚDO
--
-- `alter type ... add value` não pode ser USADO na mesma transação em que roda.
-- O Postgres recusa com 55P04, "unsafe use of new value" — e recusa mesmo que o
-- uso esteja quinze comandos abaixo. Cada migration do Supabase é UMA
-- transação, então acrescentar o valor e escrever a função que o lê no mesmo
-- arquivo é garantia de falha.
--
-- Eu tinha escrito isso no cabeçalho e errei mesmo assim, na mesma hora.
--
-- Então: aqui entram as colunas e o valor novo do enum. A 0054 usa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- O terceiro tipo de lançamento.
--
-- `alter type ... add value` NÃO pode ser usado na mesma transação em que é
-- criado (lição da 0031). Por isso a coluna `kind` do ledger é `text` com
-- check — e aqui basta reescrever o check.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tipo text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_tipo
    from pg_attribute a
   where a.attrelid = 'public.customer_cashback_ledger'::regclass and a.attname = 'kind';

  if v_tipo = 'text' then
    alter table public.customer_cashback_ledger
      drop constraint if exists customer_cashback_ledger_kind_check;
    alter table public.customer_cashback_ledger
      add constraint customer_cashback_ledger_kind_check
      check (kind in ('credito', 'resgate', 'expiracao'));
  else
    -- É enum: acrescenta o valor. Fora de bloco de transação isto seria
    -- direto; aqui o `if not exists` evita erro na reaplicação.
    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = v_tipo and e.enumlabel = 'expiracao'
    ) then
      execute format('alter type public.%I add value if not exists %L', v_tipo, 'expiracao');
    end if;
  end if;
end $$;


alter table public.restaurants
  add column if not exists cashback_carencia_horas int not null default 24,
  add column if not exists cashback_validade_dias  int not null default 0;

comment on column public.restaurants.cashback_carencia_horas is
  'Horas até o saldo poder ser usado. 0 = vale na hora.';

comment on column public.restaurants.cashback_validade_dias is
  'Dias até o saldo sumir. 0 = NUNCA expira, e é o padrão: casa que não '
  'escolheu não tira nada de ninguém por omissão.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_carencia_sensata') then
    alter table public.restaurants
      add constraint restaurants_carencia_sensata
      check (cashback_carencia_horas between 0 and 720);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_validade_sensata') then
    alter table public.restaurants
      add constraint restaurants_validade_sensata
      check (cashback_validade_dias between 0 and 3650);
  end if;
end $$;
