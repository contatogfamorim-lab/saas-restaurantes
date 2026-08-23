-- =============================================================================
-- 0024 — Volta ao login simples: usuário e senha, para todo mundo
-- =============================================================================
-- Remove o aparelho confiável e a senha de 5 dígitos.
--
-- O que estava em pé antes: 5 dígitos só eram aceitáveis com aparelho liberado,
-- bloqueio e auditoria. Tirar o aparelho tornaria os 5 dígitos frágeis; então
-- sai o conjunto inteiro, e a senha volta a ser senha de verdade, validada pelo
-- Supabase Auth.
--
-- `operator_code` FICA, mas com outro papel: passa a ser nome de usuário. Quem
-- está no tablet da cozinha digita `02`, não `cozinha@brasaburger.test`. O
-- servidor troca o código pelo e-mail antes de autenticar; o e-mail continua
-- existindo como identificador interno.
--
-- Consequência para a spec: a §10.5 (PIN de 4 dígitos em aparelho confiável)
-- deixa de valer como escrita. O rate limiting de login passa a ser o do
-- GoTrue, configurado em supabase/config.toml — e a §10.6 continua pendente
-- para a Etapa 12 quanto ao resto.
-- =============================================================================

drop table if exists public.trusted_devices;

drop function if exists public.register_pin_failure(uuid);
drop function if exists public.register_pin_success(uuid);

alter table public.profiles
  drop column if exists pin_hash,
  drop column if exists pin_failed_attempts,
  drop column if exists pin_locked_until;

comment on column public.profiles.operator_code is
  'Nome de usuário curto, alternativo ao e-mail. Quem está no tablet digita '
  '"02" em vez do endereço inteiro. Não é segredo — a senha é.';
