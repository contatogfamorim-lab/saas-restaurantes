-- =============================================================================
-- 0019 — estado 'held' (marcha / coursing)
-- =============================================================================
-- Spec §5: "entradas vão pra cozinha, principais ficam retidos até ele tocar
-- 'Liberar principais'. Sem isso, a sobremesa sai junto com o prato principal e
-- a experiência morre."
--
-- Por que um ESTADO e não um booleano `retido`:
--
--   O cronômetro da cozinha começa em `queued_at`. Se o item retido já
--   entrasse como `queued`, o relógio correria enquanto o prato nem foi
--   mandado — e o KDS mostraria "atrasado" para algo que ninguém pediu ainda.
--   Com um estado próprio, `queued_at` é carimbado na LIBERAÇÃO, que é o
--   instante em que a cozinha de fato assume o item.
--
-- Fica sozinho nesta migration porque o Postgres não permite usar um valor de
-- enum na mesma transação em que ele é criado.
-- =============================================================================

alter type public.order_item_status add value if not exists 'held' after 'pending';
