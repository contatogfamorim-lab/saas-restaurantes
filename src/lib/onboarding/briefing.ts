/**
 * As listas fechadas do briefing.
 *
 * Em módulo próprio, e não junto das Server Actions, porque arquivo com
 * `'use server'` no topo só pode exportar função assíncrona — uma constante
 * exportada de lá derruba o build inteiro, e o `tsc` não avisa. Já aconteceu
 * neste projeto com um `export { x } from`.
 *
 * O formulário do cliente e o Zod do servidor leem daqui os dois, então a lista
 * não tem como divergir entre a tela e a validação.
 */

/**
 * Os fusos do Brasil, e só eles.
 *
 * Lista fechada em vez de campo livre porque `timezone` entra em `AT TIME ZONE`
 * em todo fechamento de caixa: string inválida não dá erro bonito, dá
 * faturamento carimbado no dia errado.
 */
export const FUSOS = [
  { valor: 'America/Sao_Paulo', rotulo: 'Brasília — SP, RJ, MG, Sul, Nordeste' },
  { valor: 'America/Manaus', rotulo: 'Manaus — AM, RO, RR, MT' },
  { valor: 'America/Rio_Branco', rotulo: 'Rio Branco — Acre' },
  { valor: 'America/Noronha', rotulo: 'Fernando de Noronha' },
] as const;

/**
 * As cozinhas que o catálogo do banco conhece.
 *
 * Precisa bater com `app.catalogo_por_cozinha` (migration 0034). Um valor que
 * não existe lá não dá erro: cai no `else` e gera o cardápio genérico — o que é
 * pior que falhar, porque ninguém percebe.
 */
/**
 * Os cinco tipos de DEMONSTRAÇÃO.
 *
 * Antes isto se chamava COZINHAS e servia para o sistema inventar o cardápio da
 * casa. Não serve mais para isso: restaurante de verdade nasce com cardápio
 * vazio, porque o sistema não sabe o que aquela casa vende (migration 0059).
 *
 * Cinco, e não seis genéricos, porque são cinco negócios que aparecem
 * DIFERENTE na tela: uma balada vende garrafa de R$ 420 e não tem entrada; uma
 * açaiteria vende por tamanho e vive de adicional; uma pizzaria vende um item
 * que duas pessoas dividem. Quem está avaliando o produto quer se ver ali
 * dentro, não ver uma média de todos.
 *
 * A lista espelha `app.tipos_de_demonstracao()`. O banco é quem manda: é lá que
 * a geração acontece, e é lá que um tipo desconhecido é recusado.
 */
export const COZINHAS = [
  { valor: 'hamburgueria', rotulo: 'Hamburgueria', descricao: 'Lanches na chapa, porções e milk-shake' },
  { valor: 'pizzaria', rotulo: 'Pizzaria', descricao: 'Pizzas inteiras e meio a meio, doces e salgadas' },
  { valor: 'oriental', rotulo: 'Oriental', descricao: 'Sushi, temaki, hot rolls e combinados' },
  { valor: 'acaiteria', rotulo: 'Açaiteria', descricao: 'Açaí por tamanho, cremes e adicionais' },
  { valor: 'balada', rotulo: 'Balada / Bar', descricao: 'Drinks, garrafas, combos e petiscos' },
] as const;

export type Cozinha = (typeof COZINHAS)[number]['valor'];
export type Fuso = (typeof FUSOS)[number]['valor'];
