-- =============================================================================
-- 0065 — Onde a malha crua espera o acabamento
-- =============================================================================
-- A geração e o acabamento passaram a acontecer em MÁQUINAS DIFERENTES.
--
-- Gerar exige GPU: 16 GB de VRAM no mínimo, que não existe no notebook de quem
-- desenvolve isto. Acabar — encaixar a escala, tirar a mesa, simplificar,
-- comprimir — é trabalho de CPU e roda em qualquer lugar.
--
-- Separar os dois tem uma consequência boa além da óbvia: o acabamento continua
-- sendo UM código só, em Node, já depurado. A alternativa seria reescrevê-lo em
-- Python dentro do caderno da GPU, e manter duas versões da mesma regra —
-- escala em metros, origem na base, o detector de mesa — que divergiriam na
-- primeira correção feita só de um lado.
--
-- Então o caderno da GPU sobe a malha como veio e marca `bruto_path`. A máquina
-- de casa vê a linha, baixa, acaba e publica. `status` continua contando a
-- história: 'processando' com `bruto_path` preenchido significa "a parte cara
-- está feita, falta a barata".
--
-- Guardar o bruto também é a rede contra erro de acabamento. Já aconteceu: uma
-- conversão de textura errada só apareceu com o prato branco na tela, e refazer
-- custou uma geração inteira de uma cota que dá cinco pratos por dia. Com o
-- bruto no bucket, corrigir é reprocessar — custo zero de GPU.
-- =============================================================================

alter table public.product_models
  add column bruto_path text check (length(bruto_path) <= 400);

comment on column public.product_models.bruto_path is
  'Caminho no bucket product-models da malha como o gerador entregou, antes de '
  'escala, limpeza e compressão. Preenchido por quem tem GPU; consumido por '
  'quem faz o acabamento. Preservado depois de pronto, para reprocessar sem GPU.';

-- Achar o que está esperando acabamento é a consulta que o worker de CPU faz em
-- laço; sem índice ela varre a tabela inteira a cada rodada.
create index product_models_esperando_acabamento_idx
  on public.product_models (restaurant_id)
  where status = 'processando' and bruto_path is not null;
