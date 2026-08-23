import type { Pool } from 'pg';

/**
 * Deixa o banco num estado conhecido antes da suíte.
 *
 * Sem isto, os testes só passam logo depois de um `db:reset` — e quebram para
 * quem acabou de usar o app local, porque sobra comanda aberta e o índice
 * único "uma sessão por mesa" derruba metade dos casos. Teste que depende de o
 * desenvolvedor ter feito a coisa certa antes não é teste, é armadilha.
 *
 * Fecha o que ficou aberto em vez de apagar: `orders` e `order_items` têm
 * trigger de imutabilidade, e o objetivo aqui é liberar as mesas, não simular
 * uma base virgem.
 */
export async function prepararBanco(pool: Pool, restaurantId: string) {
  await pool.query(
    `update public.table_sessions
        set status = 'closed', closed_at = now()
      where restaurant_id = $1 and status in ('open', 'closing')`,
    [restaurantId],
  );

  // devolve o estoque das promoções ao valor do seed, para que os testes de
  // esgotamento partam sempre do mesmo ponto
  await pool.query(
    `update public.promotions set used_quantity = 0 where restaurant_id = $1`,
    [restaurantId],
  );

  // e desfaz as flags que alguns testes ligam (eles rodam em transação
  // desfeita, mas um teste interrompido no meio pode deixar rastro)
  await pool.query(
    `update public.restaurants
        set require_phone = false, require_waiter_to_open_table = false
      where id = $1`,
    [restaurantId],
  );

  await pool.query(
    `update public.products set is_available = true
      where restaurant_id = $1 and not is_available`,
    [restaurantId],
  );
}
