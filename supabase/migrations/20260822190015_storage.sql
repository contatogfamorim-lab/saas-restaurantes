-- =============================================================================
-- 0015 — Storage das fotos de produto
-- =============================================================================
-- Spec §10.2: "bucket de fotos com leitura pública e escrita só autenticada.
-- Nunca escrita pública."
--
-- Convenção de caminho: {restaurant_id}/{product_id}.webp
--
-- O restaurant_id ser o PRIMEIRO segmento não é organização de pastas — é
-- controle de acesso. A policy compara esse segmento com o restaurante de quem
-- escreve, então um funcionário do restaurante A não consegue gravar, trocar
-- nem apagar foto no diretório do B. Sem isso, o bucket seria um espaço plano
-- onde qualquer tenant sobrescreve o arquivo de qualquer outro.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-photos',
  'product-photos',
  true,
  -- 8 MB no limite do bucket: o dono VAI subir foto tirada no celular
  -- (spec §13.2). O corte e a compressão acontecem antes de chegar aqui;
  -- este número é a rede de segurança, não a meta.
  8388608,
  array['image/webp', 'image/avif', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Leitura pública: o cardápio é público por natureza, e a foto com ele.
-- -----------------------------------------------------------------------------
create policy "fotos de produto: leitura pública"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-photos');

-- -----------------------------------------------------------------------------
-- Escrita: só equipe, só no diretório do próprio restaurante, e só quem tem
-- permissão de conteúdo de cardápio (spec §12.9).
-- -----------------------------------------------------------------------------
create policy "fotos de produto: escrita do próprio restaurante"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
    and app.has_menu_permission('menu.content')
  );

create policy "fotos de produto: troca do próprio restaurante"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
    and app.has_menu_permission('menu.content')
  )
  with check (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
    and app.has_menu_permission('menu.content')
  );

create policy "fotos de produto: remoção do próprio restaurante"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
    and app.has_menu_permission('menu.content')
  );

-- -----------------------------------------------------------------------------
-- products.image_url passa a aceitar DUAS formas:
--   • caminho no bucket ("uuid-do-restaurante/uuid-do-produto.webp")
--   • URL absoluta (foto hospedada fora, caso de migração de cardápio antigo)
--
-- Guardar o caminho em vez da URL inteira é o que permite trocar de ambiente
-- — local, staging, produção — sem reescrever 30 linhas de banco.
-- -----------------------------------------------------------------------------
comment on column public.products.image_url is
  'Caminho no bucket product-photos ({restaurant_id}/{product_id}.webp) ou URL '
  'absoluta. A URL pública é montada na leitura, nunca armazenada.';
