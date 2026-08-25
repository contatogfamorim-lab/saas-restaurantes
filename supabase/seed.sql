-- =============================================================================
-- SEED — apenas ambiente local e staging (spec §13.3). Nunca em produção.
-- =============================================================================
-- Hamburgueria fictícia, para exercitar a direção visual "Balcão noturno".
-- 1 restaurante · 8 mesas · 5 categorias · 30 produtos · 6 grupos de
-- modificadores · 5 usuários (um deles acumulando waiter + cashier).
--
-- Login: usuário e senha. "Usuário" aceita o e-mail OU o código do crachá.
--
--   usuário   senha                 quem
--   --------  --------------------  ---------------------------
--   00        senha-de-teste-123    Marisa   administrador
--   01        senha-de-teste-123    Ivo      garçom
--   02        senha-de-teste-123    Ravi     cozinha
--   03        senha-de-teste-123    Selma    caixa
--   04        senha-de-teste-123    Nara     garçom + caixa
--
-- Credenciais de desenvolvimento. Não reaproveitar em lugar nenhum.
-- =============================================================================

-- `briefing_at` preenchido: o Brasa Burger nasce aqui com cardápio, mesas e
-- equipe prontos, e o briefing (§14) existe justamente para o restaurante que
-- nasce vazio. Sem esta coluna, o portão de `exigirStaff` manda TODA tela
-- logada para /comecar — foi o que o `check:routes` acusou, em quinze rotas de
-- uma vez, no primeiro `pnpm verify` depois do portão entrar.
--
-- O backfill da migration 0034 não alcança esta linha: ele roda quando a
-- migration é aplicada, e o seed insere depois.
insert into public.restaurants
  (id, name, slug, brand_color, service_fee_pct, require_phone, timezone,
   briefing_at)
values
  ('11111111-1111-4111-8111-111111111111', 'Brasa Burger', 'brasa-burger',
   '#D97A28', 10, false, 'America/Sao_Paulo', now());

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
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'dono@brasaburger.test',    'Marisa Aoki'),
  ('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'garcom@brasaburger.test',  'Ivo Bezerra'),
  ('aaaaaaaa-0000-4000-8000-000000000003'::uuid, 'cozinha@brasaburger.test', 'Ravi Nunes'),
  ('aaaaaaaa-0000-4000-8000-000000000004'::uuid, 'caixa@brasaburger.test',   'Selma Prado'),
  ('aaaaaaaa-0000-4000-8000-000000000005'::uuid, 'duplo@brasaburger.test',   'Nara Vilaça')
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
--
-- `operator_code` é NOME DE USUÁRIO, não segredo: quem está no tablet digita
-- "02" em vez de cozinha@brasaburger.test. A senha é que autentica.
insert into public.profiles (id, restaurant_id, name, roles, permissions, operator_code)
values
  ('aaaaaaaa-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', 'Marisa Aoki',
   array['owner']::public.staff_role[], '{}', '00'),
  ('aaaaaaaa-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111', 'Ivo Bezerra',
   array['waiter']::public.staff_role[], '{}', '01'),
  ('aaaaaaaa-0000-4000-8000-000000000003',
   '11111111-1111-4111-8111-111111111111', 'Ravi Nunes',
   array['kitchen']::public.staff_role[], '{}', '02'),
  ('aaaaaaaa-0000-4000-8000-000000000004',
   '11111111-1111-4111-8111-111111111111', 'Selma Prado',
   array['cashier']::public.staff_role[], '{}', '03'),
  ('aaaaaaaa-0000-4000-8000-000000000005',
   '11111111-1111-4111-8111-111111111111', 'Nara Vilaça',
   array['waiter','cashier']::public.staff_role[], '{}', '04');

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
   'Burgers',      1, 'cozinha', null, null, null),
  ('22222222-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Pra dividir',  2, 'cozinha', null, null, null),
  ('22222222-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'Sobremesas',   3, 'cozinha', null, null, null),
  ('22222222-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   'Bebidas',      4, 'bar',     null, null, null),
  ('22222222-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
   'Happy Hour',   5, 'bar',     '17:00', '20:00', array[1,2,3,4,5]);

-- -----------------------------------------------------------------------------
-- Grupos de modificadores — reutilizáveis entre produtos (spec §12.6):
-- "Ponto da carne" se cria UMA vez e vale para todos os burgers.
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
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000001', 'Mal passado',  0, 1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000001', 'Ao ponto',     0, 2),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000001', 'Bem passado',  0, 3),
  -- Acompanhamento
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000002', 'Fritas',           0,   1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000002', 'Fritas rústicas',  400, 2),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000002', 'Onion rings',      700, 3),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000002', 'Salada verde',     0,   4),
  -- Adicionais
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000003', 'Bacon',               600, 1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000003', 'Cheddar extra',       500, 2),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000003', 'Ovo',                 300, 3),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000003', 'Cebola caramelizada', 400, 4),
  -- Retirar ingrediente (é o que a cozinha precisa ver em destaque no KDS)
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem cebola', 0, 1),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem picles', 0, 2),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem molho',  0, 3),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem tomate', 0, 4),
  ('11111111-1111-4111-8111-111111111111', '33333333-0000-4000-8000-000000000004', 'Sem queijo', 0, 5),
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
-- Burgers (12)
('44444444-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Smash Clássico','Dois discos de 90 g prensados na chapa, queijo prato, cebola e molho da casa.',
 3200,14,1,'{}','{mais_pedido}',1),
('44444444-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Smash Duplo','Quatro discos, dobro de queijo, picles e maionese defumada.',
 4200,16,1,'{}','{mais_pedido}',2),
('44444444-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Cheddar Bacon','180 g de blend angus, cheddar derretido na chapa e bacon crocante.',
 4600,18,1,'{}','{}',3),
('44444444-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Salada Completo','160 g, alface, tomate, cebola roxa, picles e molho especial.',
 3800,16,1,'{}','{}',4),
('44444444-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Costela Defumada','Costela desfiada por 12 horas na defumação, queijo e barbecue da casa.',
 5200,20,1,'{}','{da_casa}',5),
('44444444-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Frango Crocante','Sobrecoxa empanada na hora, coleslaw e maionese de ervas.',
 3600,18,1,'{}','{}',6),
('44444444-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Trinca da Casa','Três burgers, duas porções de fritas e três bebidas. Serve bem três pessoas.',
 8900,26,3,'{}','{da_casa}',7),
('44444444-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Cogumelos e Alho','180 g, mix de cogumelos salteados, queijo suíço e alho confitado.',
 5400,20,1,'{}','{novo}',8),
('44444444-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Veggie de Grão-de-Bico','Hambúrguer de grão-de-bico e beterraba, pão sem leite, maionese vegana.',
 3900,18,1,'{vegano,vegetariano,sem_lactose}','{novo}',9),
('44444444-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Picanha no Pão','Picanha fatiada na chapa, queijo coalho e vinagrete de tomate.',
 5800,22,1,'{}','{}',10),
('44444444-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Duplo Pimenta','Dois discos, pepper jack, jalapeño e maionese de chipotle. Arde de verdade.',
 4400,16,1,'{apimentado}','{picante}',11),
('44444444-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000001',
 'Kids','90 g, queijo prato e pão macio. Acompanha fritas pequenas.',
 2600,12,1,'{}','{}',12),
-- Pra dividir (6)
('44444444-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Fritas com Cheddar e Bacon','Porção generosa, cheddar cremoso e bacon em cubos.',
 3200,15,3,'{}','{mais_pedido}',1),
('44444444-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Onion Rings','Anéis de cebola empanados na cerveja, com molho ranch.',
 2800,14,2,'{vegetariano}','{}',2),
('44444444-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Batata Rústica','Com casca, alecrim e sal grosso. Molho de ervas à parte.',
 2600,18,2,'{vegetariano,sem_gluten}','{}',3),
('44444444-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Frango a Passarinho','Marinado no alho, frito na hora, com limão siciliano.',
 3800,20,3,'{sem_gluten,sem_lactose}','{}',4),
('44444444-0000-4000-8000-000000000017','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Mandioca Frita','Cozida e frita na hora, crocante por fora e macia por dentro.',
 2400,16,2,'{vegano,vegetariano,sem_gluten,sem_lactose}','{}',5),
('44444444-0000-4000-8000-000000000018','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000002',
 'Nuggets Caseiros','Doze unidades de peito de frango empanado, com mostarda e mel.',
 2900,16,2,'{}','{}',6),
-- Sobremesas (4)
('44444444-0000-4000-8000-000000000019','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Milkshake de Doce de Leite','500 ml, sorvete artesanal e doce de leite argentino.',
 2400,6,1,'{vegetariano}','{mais_pedido}',1),
('44444444-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Petit Gateau','Bolo quente de chocolate 70% com sorvete de creme.',
 2800,14,1,'{vegetariano}','{}',2),
('44444444-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Brownie com Sorvete','Brownie de nozes morno, bola de creme e calda quente.',
 2600,8,1,'{vegetariano}','{}',3),
('44444444-0000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000003',
 'Cheesecake de Frutas Vermelhas','Base de biscoito amanteigado e calda da fruta.',
 2600,6,1,'{vegetariano}','{}',4),
-- Bebidas (5)
('44444444-0000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Água Mineral','Com ou sem gás, 500 ml.',
 700,2,1,'{vegano,vegetariano,sem_gluten,sem_lactose}','{}',1),
('44444444-0000-4000-8000-000000000024','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Refrigerante','Lata 350 ml.',
 900,2,1,'{vegano,vegetariano,sem_gluten,sem_lactose}','{}',2),
('44444444-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Suco Natural','Laranja, abacaxi com hortelã ou maracujá.',
 1600,6,1,'{vegano,vegetariano,sem_gluten,sem_lactose}','{}',3),
('44444444-0000-4000-8000-000000000026','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Cerveja Long Neck','Pilsen ou IPA, 355 ml.',
 1400,2,1,'{vegetariano,sem_lactose}','{}',4),
('44444444-0000-4000-8000-000000000027','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000004',
 'Limonada Suíça','Feita na hora, com leite condensado ou sem.',
 1400,6,1,'{vegetariano,sem_gluten}','{}',5),
-- Happy Hour (3) — categoria só aparece 17h–20h, seg a sex
('44444444-0000-4000-8000-000000000028','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000005',
 'Chopp Pilsen','Tirado na hora, colarinho de dois dedos.',
 1600,2,1,'{vegetariano,sem_lactose}','{}',1),
('44444444-0000-4000-8000-000000000029','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000005',
 'Porção de Calabresa','Calabresa artesanal acebolada, com pão torrado.',
 4000,16,3,'{}','{}',2),
('44444444-0000-4000-8000-000000000030','11111111-1111-4111-8111-111111111111','22222222-0000-4000-8000-000000000005',
 'Isca de Frango','Tiras empanadas com páprica defumada e molho de alho.',
 3800,18,3,'{}','{}',3);

-- -----------------------------------------------------------------------------
-- Aplicação dos grupos de modificadores aos produtos
-- -----------------------------------------------------------------------------
insert into public.product_modifier_groups (restaurant_id, product_id, group_id, sort_order)
select '11111111-1111-4111-8111-111111111111', m.product_id, m.group_id, m.sort_order
from (values
  -- burgers de carne bovina: ponto + acompanhamento + adicionais + retirar
  ('44444444-0000-4000-8000-000000000001'::uuid,'33333333-0000-4000-8000-000000000001'::uuid,1),
  ('44444444-0000-4000-8000-000000000001','33333333-0000-4000-8000-000000000002',2),
  ('44444444-0000-4000-8000-000000000001','33333333-0000-4000-8000-000000000003',3),
  ('44444444-0000-4000-8000-000000000001','33333333-0000-4000-8000-000000000004',4),
  ('44444444-0000-4000-8000-000000000002','33333333-0000-4000-8000-000000000001',1),
  ('44444444-0000-4000-8000-000000000002','33333333-0000-4000-8000-000000000002',2),
  ('44444444-0000-4000-8000-000000000002','33333333-0000-4000-8000-000000000003',3),
  ('44444444-0000-4000-8000-000000000002','33333333-0000-4000-8000-000000000004',4),
  ('44444444-0000-4000-8000-000000000003','33333333-0000-4000-8000-000000000001',1),
  ('44444444-0000-4000-8000-000000000003','33333333-0000-4000-8000-000000000002',2),
  ('44444444-0000-4000-8000-000000000003','33333333-0000-4000-8000-000000000003',3),
  ('44444444-0000-4000-8000-000000000003','33333333-0000-4000-8000-000000000004',4),
  ('44444444-0000-4000-8000-000000000004','33333333-0000-4000-8000-000000000001',1),
  ('44444444-0000-4000-8000-000000000004','33333333-0000-4000-8000-000000000002',2),
  ('44444444-0000-4000-8000-000000000004','33333333-0000-4000-8000-000000000004',3),
  ('44444444-0000-4000-8000-000000000010','33333333-0000-4000-8000-000000000001',1),
  ('44444444-0000-4000-8000-000000000010','33333333-0000-4000-8000-000000000002',2),
  ('44444444-0000-4000-8000-000000000010','33333333-0000-4000-8000-000000000004',3),
  ('44444444-0000-4000-8000-000000000011','33333333-0000-4000-8000-000000000001',1),
  ('44444444-0000-4000-8000-000000000011','33333333-0000-4000-8000-000000000002',2),
  ('44444444-0000-4000-8000-000000000011','33333333-0000-4000-8000-000000000004',3),
  -- sem ponto de carne: costela desfiada, frango, cogumelos, veggie, kids
  ('44444444-0000-4000-8000-000000000005','33333333-0000-4000-8000-000000000002',1),
  ('44444444-0000-4000-8000-000000000005','33333333-0000-4000-8000-000000000003',2),
  ('44444444-0000-4000-8000-000000000005','33333333-0000-4000-8000-000000000004',3),
  ('44444444-0000-4000-8000-000000000006','33333333-0000-4000-8000-000000000002',1),
  ('44444444-0000-4000-8000-000000000006','33333333-0000-4000-8000-000000000004',2),
  ('44444444-0000-4000-8000-000000000008','33333333-0000-4000-8000-000000000002',1),
  ('44444444-0000-4000-8000-000000000008','33333333-0000-4000-8000-000000000004',2),
  ('44444444-0000-4000-8000-000000000009','33333333-0000-4000-8000-000000000002',1),
  ('44444444-0000-4000-8000-000000000009','33333333-0000-4000-8000-000000000004',2),
  ('44444444-0000-4000-8000-000000000012','33333333-0000-4000-8000-000000000004',1),
  -- combo: só acompanhamento e retirar
  ('44444444-0000-4000-8000-000000000007','33333333-0000-4000-8000-000000000002',1),
  ('44444444-0000-4000-8000-000000000007','33333333-0000-4000-8000-000000000004',2),
  -- porções com ingrediente removível
  ('44444444-0000-4000-8000-000000000013','33333333-0000-4000-8000-000000000004',1),
  ('44444444-0000-4000-8000-000000000016','33333333-0000-4000-8000-000000000004',1),
  -- bebidas: tamanho e gelo
  ('44444444-0000-4000-8000-000000000025','33333333-0000-4000-8000-000000000006',1),
  ('44444444-0000-4000-8000-000000000027','33333333-0000-4000-8000-000000000006',1),
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
  -- happy hour: entra e sai sozinha no horário, sem ninguém mexer
  ('55555555-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'Chopp pela metade — happy hour','active', array[1,2,3,4,5],'17:00','20:00',
   'percent', 50, 100, 'HAPPY HOUR', '#D97A28', 'auto',
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
   'Costela defumada — 10 hoje','active','percent', 25,
   10, 10, 'ÚLTIMAS UNIDADES', '#B4322A', 'auto',
   'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.promotion_targets
  (restaurant_id, promotion_id, target_type, target_id)
values
  ('11111111-1111-4111-8111-111111111111','55555555-0000-4000-8000-000000000001',
   'product','44444444-0000-4000-8000-000000000028'),
  ('11111111-1111-4111-8111-111111111111','55555555-0000-4000-8000-000000000002',
   'product','44444444-0000-4000-8000-000000000003'),
  ('11111111-1111-4111-8111-111111111111','55555555-0000-4000-8000-000000000003',
   'product','44444444-0000-4000-8000-000000000005');

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
