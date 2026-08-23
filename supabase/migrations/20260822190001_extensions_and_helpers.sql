-- =============================================================================
-- 0001 — Extensões, schema privado e utilitários sem dependência de tabela
-- =============================================================================
-- O schema `app` NÃO é exposto pelo PostgREST (ver supabase/config.toml,
-- api.schemas). Helpers vivem aqui para não virarem endpoint.
--
-- Só entram aqui funções que NÃO tocam em tabela. Os helpers de autorização,
-- que consultam `profiles`, estão em 0004 — funções `language sql` têm o corpo
-- validado no CREATE, então referenciar uma tabela que ainda não existe faz a
-- migration falhar.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- short_code das mesas: nanoid de 10 chars, alfabeto URL-safe sem ambiguidade.
-- Aleatório por definição — jamais sequencial nem derivado do número da mesa
-- (spec §10.4: senão qualquer um enumera as mesas de todos os restaurantes).
-- -----------------------------------------------------------------------------
create or replace function app.generate_short_code(size int default 10)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- sem 0/O/1/I/l: o código também é impresso no adesivo e digitado à mão
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  alphabet_len constant int := length(alphabet);
  result text := '';
  idx int;
begin
  for i in 1..size loop
    idx := 1 + (get_byte(extensions.gen_random_bytes(1), 0) % alphabet_len);
    result := result || substr(alphabet, idx, 1);
  end loop;
  return result;
end;
$$;
