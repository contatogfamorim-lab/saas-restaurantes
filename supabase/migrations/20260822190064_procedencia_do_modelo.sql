-- =============================================================================
-- 0064 — De onde veio o modelo, e se a medida é confiável
-- =============================================================================
-- A 0063 criou a tabela sem responder duas perguntas que passaram a importar
-- assim que a geração automática entrou:
--
-- DE ONDE ESTE MODELO VEIO? Um prato pode ter sido digitalizado a partir da
-- foto única do cardápio, de uma sequência de ângulos tirada pelo dono, ou ser
-- um modelo de teste do ambiente de desenvolvimento. As três coisas parecem
-- iguais no cardápio e são muito diferentes quando algo sai errado: refazer o
-- lote inteiro é seguro se der para separar o que é teste do que é do cliente.
--
-- A MEDIDA É MEDIDA OU É CHUTE? `largura_cm` sustenta a promessa de tamanho
-- real no AR. Quando ela vem de um objeto de referência na foto, é medida.
-- Quando vem da nossa tabela de "prato raso costuma ter 26 cm", é estimativa —
-- e prometer tamanho exato em cima de estimativa é o tipo de mentira pequena
-- que destrói a confiança no recurso inteiro. A coluna existe para a interface
-- poder dizer "tamanho aproximado" em vez de "tamanho real".
-- =============================================================================

create type public.origem_do_modelo as enum (
  'foto',        -- gerado a partir da foto única já cadastrada no cardápio
  'captura',     -- gerado a partir de fotos de vários ângulos tiradas pelo dono
  'importado',   -- arquivo pronto, enviado por quem já tinha o modelo
  'teste'        -- semeado em desenvolvimento; nunca deve existir em produção
);

alter table public.product_models
  add column origem public.origem_do_modelo not null default 'foto',

  -- Qual serviço gerou. Texto livre e não enum de propósito: a lista de
  -- geradores muda mais rápido que o schema, e este campo é para leitura
  -- humana e para decidir o que refazer quando um provedor for trocado.
  add column provedor text check (length(provedor) <= 60),

  -- Segundos que a geração levou. É o custo, e sem ele não há como saber
  -- quanto custa digitalizar um cardápio antes de já ter digitalizado um.
  add column segundos numeric(6,1) check (segundos >= 0),

  -- `true` enquanto ninguém mediu de verdade. Começa `true` porque o caminho
  -- que existe hoje — deduzir do nome do prato — é palpite, e o padrão de uma
  -- coluna dessas tem que ser o lado pessimista.
  add column largura_estimada boolean not null default true;

comment on column public.product_models.largura_estimada is
  'true quando largura_cm foi deduzida do tipo do prato em vez de medida por '
  'objeto de referência. A interface do AR deve dizer "aproximado" enquanto for true.';

comment on column public.product_models.origem is
  'Como o modelo nasceu. ''teste'' nunca deve aparecer em produção — é o que '
  'permite apagar o seed sem tocar no que é do cliente.';
