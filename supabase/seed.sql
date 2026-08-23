-- =============================================================================
-- SEED — apenas ambiente local e staging (spec §13.3). Nunca em produção.
-- =============================================================================
-- 1 restaurante · 8 mesas · 5 categorias · 30 produtos · 6 grupos de
-- modificadores · 5 usuários (um deles acumulando waiter + cashier).
--
-- Senha de TODOS os usuários: senha-de-teste-123
-- PINs: dono 7391 · garçom 4762 · cozinha 9138 · caixa 2957 · duplo 6483
-- Credenciais de desenvolvimento. Não reaproveitar em lugar nenhum.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Restaurante
-- -----------------------------------------------------------------------------
insert into public.restaurants
  (id, name, slug, brand_color, service_fee_pct, require_phone, timezone)
values
  ('11111111-1111-4111-8111-111111111111', 'Cantina do Beco', 'cantina-do-beco',
   '#B4322A', 10, false, 'America/Sao_Paulo');

-- -----------------------------------------------------------------------------
-- Equipe — auth.users + identities + profiles
-- -----------------------------------------------------------------------------
-- Os campos de token vão como '' e não NULL de propósito: o GoTrue trata NULL
-- nessas colunas como estado inconsistente e o login falha sem mensagem útil.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('senha-de-teste-123', extensions.gen_salt('bf', 10)),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('name', u.name),
  now(), now(),
  '', '', '', '', ''
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'dono@cantinadobeco.test',    'Marisa Aoki'),
  ('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'garcom@cantinadobeco.test',  'Ivo Bezerra'),
  ('aaaaaaaa-0000-4000-8000-000000000003'::uuid, 'cozinha@cantinadobeco.test', 'Ravi Nunes'),
  ('aaaaaaaa-0000-4000-8000-000000000004'::uuid, 'caixa@cantinadobeco.test',   'Selma Prado'),
  ('aaaaaaaa-0000-4000-8000-000000000005'::uuid, 'duplo@cantinadobeco.test',   'Nara Vilaça')
) as u(id, email, name);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u;

-- roles é ARRAY: Nara acumula garçom E caixa, com um cadastro só (spec P1b).
insert into public.profiles (id, restaurant_id, name, roles, permissions, pin_hash)
values
  ('aaaaaaaa-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', 'Marisa Aoki',
   array['owner']::public.staff_role[], '{}',
   '$argon2id$v=19$m=19456,t=2,p=1$almiGCyOHTpjjO8GI9/I4A$drBQ96HG6NpFvfaGBBQRQbqUKU57gvdpkdfzVMwgjJ0'),
  ('aaaaaaaa-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111', 'Ivo Bezerra',
   array['waiter']::public.staff_role[], '{}',
   '$argon2id$v=19$m=19456,t=2,p=1$w9U5WutOVEM/UmLsXkAfFw$LWte1oKDuCU0QSsiVNQ/TB5DG3kRyk3AY4amLwjPLAw'),
  ('aaaaaaaa-0000-4000-8000-000000000003',
   '11111111-1111-4111-8111-111111111111', 'Ravi Nunes',
   array['kitchen']::public.staff_role[], '{}',
   '$argon2id$v=19$m=19456,t=2,p=1$4syRp8mOzGuvoYZfYNexFA$qfWQEcE5SQDL5B8KbCSKlSmklEBtJRRNGuFaVrU6TYs'),
  ('aaaaaaaa-0000-4000-8000-000000000004',
   '11111111-1111-4111-8111-111111111111', 'Selma Prado',
   array['cashier']::public.staff_role[], '{}',
   '$argon2id$v=19$m=19456,t=2,p=1$s6vbxSnPgGyxqy6gzc0ctQ$/BZEXM8onJo5d2kj58IK4wq8aOR6wuq6bUrk1Djf+7g'),
  ('aaaaaaaa-0000-4000-8000-000000000005',
   '11111111-1111-4111-8111-111111111111', 'Nara Vilaça',
   array['waiter','cashier']::public.staff_role[], '{}',
   '$argon2id$v=19$m=19456,t=2,p=1$zoA72IHaTZL8qEnC9SW2aA$3eSJTcCVXQgejS0ZqJUXejucPV44raarKizUvUDR2BQ');

-- -----------------------------------------------------------------------------
-- 8 mesas. short_code vem do default aleatório — nunca derivado do número.
-- -----------------------------------------------------------------------------
insert into public.restaurant_tables (restaurant_id, label, area, seats)
select '11111111-1111-4111-8111-111111111111', t.label, t.area, t.seats
from (values
  ('Mesa 1', 'Salão', 2), ('Mesa 2', 'Salão', 4),
  ('Mesa 3', 'Salão', 4), ('Mesa 4', 'Salão', 6),
  ('Mesa 5', 'Deck',  2), ('Mesa 6', 'Deck',  4),
  ('Mesa 7', 'Deck',  4), ('Mesa 8', 'Varanda', 8)
) as t(label, area, seats);

-- -----------------------------------------------------------------------------
-- Categorias. "Happy Hour" só existe 17h–20h de seg a sex: é o caso de teste
-- do cardápio dinâmico (spec §4).
-- -----------------------------------------------------------------------------
insert into public.categories
  (id, restaurant_id, name, sort_order, station, available_from, available_to, days_of_week)
values
  ('22222222-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Entradas',   1, 'cozinha', null, null, null),
  ('22222222-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Principais', 2, 'cozinha', null, null, null),
  ('22222222-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'Sobremesas', 3, 'cozinha', null, null, null),
  ('22222222-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   'Bebidas',    4, 'bar',     null, null, null),
  ('22222222-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
   'Happy Hour', 5, 'bar',     '17:00', '20:00', array[1,2,3,4,5]);

-- -----------------------------------------------------------------------------
-- Grupos de modificadores — reutilizáveis entre produtos (spec §12.6).
-- "Ponto da carne" se cria UMA vez e vale para todos os pratos de carne.
-- -----------------------------------------------------------------------------
insert into public.modifier_groups
  (id, restaurant_id, name, min_select, max_select, is_required, sort_order)
values
  ('33333333-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Ponto da carne',      1, 1, true,  1),
  ('33333333-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Acompanhamento',      1, 1, true,  2),
  ('33333333-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'Adicionais',          0, 4, false, 3),
  ('33333333-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   'Retirar ingrediente', 0, 5, false, 4),
  ('33333333-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
   'Tamanho',             1, 1, true,  5),
  ('33333333-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111',
   'Gelo e limão',        0, 2, false, 6);

insert into public.modifier_options
  (restaurant_id, group_id, name, price_delta_cents, sort_order)
values
  -- Ponto da carne
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000001', 'Mal passado',   0, 1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000001', 'Ao ponto',      0, 2),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000001', 'Bem passado',   0, 3),
  -- Acompanhamento
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000002', 'Arroz e feijão', 0,   1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000002', 'Purê de batata', 0,   2),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000002', 'Salada verde',   0,   3),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000002', 'Fritas',         400, 4),
  -- Adicionais
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000003', 'Bacon',                600, 1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000003', 'Queijo extra',         400, 2),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000003', 'Ovo',                  300, 3),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000003', 'Cebola caramelizada',  400, 4),
  -- Retirar ingrediente (é o que a cozinha precisa ver em destaque no KDS)
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem cebola',  0, 1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem tomate',  0, 2),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem alho',    0, 3),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem pimenta', 0, 4),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem queijo',  0, 5),
  -- Tamanho
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000005', '300 ml', 0,   1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000005', '500 ml', 500, 2),
  -- Gelo e limão
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000006', 'Sem gelo',    0, 1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000006', 'Limão extra', 0, 2);

-- -----------------------------------------------------------------------------
-- 30 produtos
-- -----------------------------------------------------------------------------
insert into public.products
  (id, restaurant_id, category_id, name, description, price_cents,
   prep_minutes, serves_people, diet_tags, badges, sort_order)
values
-- Entradas (6)
('44444444-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Bolinho de bacalhau','Oito unidades, massa leve, servido com aioli de limão siciliano.',
 4800,18,2,'{}','{mais_pedido}',1),
('44444444-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Pastel de queijo','Seis pastéis de massa fina com queijo meia cura derretido.',
 3200,12,2,'{vegetariano}','{}',2),
('44444444-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Bruschetta de tomate','Pão de fermentação natural, tomate confitado e manjericão fresco.',
 2800,10,2,'{vegetariano}','{}',3),
('44444444-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Ceviche de tilápia','Leite de tigre cítrico, cebola roxa e milho crocante.',
 5800,15,2,'{sem_gluten,sem_lactose}','{novo}',4),
('44444444-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Batata rústica','Batata assada com alecrim e sal grosso, molho de ervas à parte.',
 3400,20,2,'{vegetariano,sem_gluten}','{}',5),
('44444444-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Coxinha de frango','Quatro unidades, recheio de frango desfiado com requeijão.',
 3000,14,2,'{}','{da_casa}',6),
-- Principais (10)
('44444444-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Picanha na chapa','400 g de picanha fatiada, servida na chapa quente com farofa de ovo.',
 8900,28,2,'{sem_gluten}','{mais_pedido}',1),
('44444444-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Filé à parmegiana','Filé empanado, molho de tomate rústico e muçarela gratinada.',
 7600,30,1.5,'{}','{}',2),
('44444444-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Risoto de cogumelos','Arbóreo cremoso com shitake, shimeji e parmesão curado.',
 6900,25,1,'{vegetariano,sem_gluten}','{}',3),
('44444444-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Moqueca de peixe','Peixe branco, leite de coco e dendê, com arroz e pirão.',
 9800,35,2,'{sem_gluten,sem_lactose}','{da_casa}',4),
('44444444-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Feijoada completa','Servida aos sábados, com couve, laranja, farofa e torresmo.',
 7200,20,2,'{}','{}',5),
('44444444-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Burger da casa','180 g de blend angus, queijo prato e maionese defumada.',
 5400,18,1,'{}','{mais_pedido}',6),
('44444444-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Burger vegano','Hambúrguer de grão-de-bico e beterraba, pão sem leite.',
 5200,18,1,'{vegano,vegetariano,sem_lactose}','{novo}',7),
('44444444-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Frango grelhado','Sobrecoxa desossada marinada em ervas, grelhada na brasa.',
 5600,22,1,'{sem_gluten,sem_lactose}','{}',8),
('44444444-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Espaguete ao pesto','Massa fresca, pesto de manjericão e tomatinho assado.',
 5800,20,1,'{vegetariano}','{}',9),
('44444444-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Salmão grelhado','Filé de salmão com crosta de gergelim e legumes salteados.',
 9600,24,1,'{sem_gluten,sem_lactose}','{}',10),
-- Sobremesas (5)
('44444444-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Pudim de leite','Receita da casa, calda de caramelo escuro.',
 2200,5,1,'{vegetariano}','{da_casa}',1),
('44444444-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Petit gateau','Bolo quente de chocolate 70% com sorvete de creme.',
 3400,14,1,'{vegetariano}','{mais_pedido}',2),
('44444444-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Mousse de maracujá','Leve, com calda da fruta e crocante de castanha.',
 2400,5,1,'{vegetariano,sem_gluten}','{}',3),
('44444444-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Sorvete artesanal','Duas bolas. Sabores do dia no quadro.',
 2000,3,1,'{vegetariano,sem_gluten}','{}',4),
('44444444-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Cheesecake de frutas vermelhas','Base de biscoito amanteigado e calda de frutas.',
 2800,6,1,'{vegetariano}','{}',5),
-- Bebidas (6)
('44444444-0000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Água mineral','Com ou sem gás, 500 ml.',
 700,2,1,'{vegano,vegetariano,sem_gluten,sem_lactose}','{}',1),
('44444444-0000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Refrigerante','Lata 350 ml.',
 900,2,1,'{vegano,vegetariano,sem_gluten,sem_lactose}','{}',2),
('44444444-0000-4000-8000-000000000024','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Suco natural','Laranja, abacaxi com hortelã ou maracujá.',
 1600,6,1,'{vegano,vegetariano,sem_gluten,sem_lactose}','{}',3),
('44444444-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Cerveja long neck','Pilsen ou IPA, 355 ml.',
 1400,2,1,'{vegetariano,sem_lactose}','{}',4),
('44444444-0000-4000-8000-000000000026','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Caipirinha','Cachaça artesanal, limão e açúcar. Também com vodca.',
 2600,5,1,'{vegano,vegetariano,sem_gluten,sem_lactose}','{mais_pedido}',5),
('44444444-0000-4000-8000-000000000027','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Taça de vinho','Tinto ou branco da casa, 150 ml.',
 3800,3,1,'{vegetariano,sem_gluten,sem_lactose}','{}',6),
-- Happy Hour (3) — categoria só aparece 17h–20h, seg a sex
('44444444-0000-4000-8000-000000000028','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000005',
 'Chopp Pilsen','Tirado na hora, colarinho de dois dedos.',
 1600,2,1,'{vegetariano,sem_lactose}','{}',1),
('44444444-0000-4000-8000-000000000029','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000005',
 'Porção de calabresa','Calabresa artesanal acebolada, com pão torrado.',
 4000,16,3,'{}','{}',2),
('44444444-0000-4000-8000-000000000030','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000005',
 'Batata frita grande','Serve bem três pessoas, com maionese da casa.',
 3600,15,3,'{vegetariano}','{}',3);

-- -----------------------------------------------------------------------------
-- Aplicação dos grupos de modificadores aos produtos
-- -----------------------------------------------------------------------------
insert into public.product_modifier_groups (restaurant_id, product_id, group_id, sort_order)
select '11111111-1111-4111-8111-111111111111', m.product_id, m.group_id, m.sort_order
from (values
  -- carnes: ponto + acompanhamento + retirar
  ('44444444-0000-4000-8000-000000000007'::uuid,'33333333-0000-4000-8000-000000000001'::uuid,1),
  ('44444444-0000-4000-8000-000000000007','33333333-0000-4000-8000-000000000002',2),
  ('44444444-0000-4000-8000-000000000007','33333333-0000-4000-8000-000000000004',3),
  ('44444444-0000-4000-8000-000000000008','33333333-0000-4000-8000-000000000002',1),
  ('44444444-0000-4000-8000-000000000008','33333333-0000-4000-8000-000000000004',2),
  ('44444444-0000-4000-8000-000000000014','33333333-0000-4000-8000-000000000002',1),
  ('44444444-0000-4000-8000-000000000014','33333333-0000-4000-8000-000000000004',2),
  ('44444444-0000-4000-8000-000000000016','33333333-0000-4000-8000-000000000002',1),
  ('44444444-0000-4000-8000-000000000016','33333333-0000-4000-8000-000000000004',2),
  -- burgers: ponto + adicionais + retirar
  ('44444444-0000-4000-8000-000000000012','33333333-0000-4000-8000-000000000001',1),
  ('44444444-0000-4000-8000-000000000012','33333333-0000-4000-8000-000000000003',2),
  ('44444444-0000-4000-8000-000000000012','33333333-0000-4000-8000-000000000004',3),
  ('44444444-0000-4000-8000-000000000013','33333333-0000-4000-8000-000000000003',1),
  ('44444444-0000-4000-8000-000000000013','33333333-0000-4000-8000-000000000004',2),
  -- massas e risoto: retirar
  ('44444444-0000-4000-8000-000000000009','33333333-0000-4000-8000-000000000004',1),
  ('44444444-0000-4000-8000-000000000015','33333333-0000-4000-8000-000000000004',1),
  ('44444444-0000-4000-8000-000000000010','33333333-0000-4000-8000-000000000004',1),
  ('44444444-0000-4000-8000-000000000011','33333333-0000-4000-8000-000000000004',1),
  -- entradas com ingrediente removível
  ('44444444-0000-4000-8000-000000000003','33333333-0000-4000-8000-000000000004',1),
  ('44444444-0000-4000-8000-000000000004','33333333-0000-4000-8000-000000000004',1),
  ('44444444-0000-4000-8000-000000000006','33333333-0000-4000-8000-000000000004',1),
  -- bebidas: tamanho e gelo
  ('44444444-0000-4000-8000-000000000024','33333333-0000-4000-8000-000000000006',1),
  ('44444444-0000-4000-8000-000000000026','33333333-0000-4000-8000-000000000006',1),
  ('44444444-0000-4000-8000-000000000028','33333333-0000-4000-8000-000000000005',1)
) as m(product_id, group_id, sort_order);

-- -----------------------------------------------------------------------------
-- Promoções — cobrem os casos que a spec §12.12 exige testar
-- -----------------------------------------------------------------------------
insert into public.promotions
  (id, restaurant_id, name, status, days_of_week, time_from, time_to,
   discount_type, discount_value, priority, badge_label, badge_color,
   applies_to, created_by)
values
  -- happy hour: entra e sai sozinha no horário
  ('55555555-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'Chopp pela metade — happy hour','active', array[1,2,3,4,5],'17:00','20:00',
   'percent', 50, 100, 'HAPPY HOUR', '#B4322A', 'auto',
   'aaaaaaaa-0000-4000-8000-000000000001'),
  -- dia da semana: terça do burger
  ('55555555-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'Terça do burger','active', array[2], null, null,
   'fixed_price', 3900, 50, 'TERÇA', '#1F6F4A', 'auto',
   'aaaaaaaa-0000-4000-8000-000000000001');

-- quantidade limitada: os dois clientes pedindo a última unidade ao mesmo tempo
insert into public.promotions
  (id, restaurant_id, name, status, discount_type, discount_value,
   max_quantity, priority, badge_label, badge_color, applies_to, created_by)
values
  ('55555555-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
   'Moqueca — 10 porções hoje','active','percent', 25,
   10, 10, 'ÚLTIMAS UNIDADES', '#C2410C', 'auto',
   'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.promotion_targets
  (restaurant_id, promotion_id, target_type, target_id)
values
  ('11111111-1111-4111-8111-111111111111','55555555-0000-4000-8000-000000000001',
   'product','44444444-0000-4000-8000-000000000028'),
  ('11111111-1111-4111-8111-111111111111','55555555-0000-4000-8000-000000000002',
   'product','44444444-0000-4000-8000-000000000012'),
  ('11111111-1111-4111-8111-111111111111','55555555-0000-4000-8000-000000000003',
   'product','44444444-0000-4000-8000-000000000010');

-- -----------------------------------------------------------------------------
-- Layout de cardápio publicado — uma seção por categoria.
-- O bloco só REFERENCIA a categoria; nome e preço continuam vindo de products.
-- -----------------------------------------------------------------------------
insert into public.menu_layouts
  (id, restaurant_id, status, version, published_at, published_by)
values
  ('66666666-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'published', 1, now(), 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.menu_blocks
  (restaurant_id, layout_id, type, sort_order, config)
select
  '11111111-1111-4111-8111-111111111111',
  '66666666-0000-4000-8000-000000000001',
  'category', c.sort_order,
  jsonb_build_object(
    'category_id', c.id,
    'variant', case when c.name = 'Bebidas' then 'compact_list' else 'thumbnail_list' end
  )
from public.categories c
where c.restaurant_id = '11111111-1111-4111-8111-111111111111';
