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
export const COZINHAS = [
  { valor: 'hamburgueria', rotulo: 'Hamburgueria' },
  { valor: 'pizzaria', rotulo: 'Pizzaria' },
  { valor: 'japonesa', rotulo: 'Japonesa' },
  { valor: 'brasileira', rotulo: 'Brasileira / Executivo' },
  { valor: 'bar', rotulo: 'Bar / Petiscaria' },
  { valor: 'cafeteria', rotulo: 'Cafeteria' },
] as const;

export type Cozinha = (typeof COZINHAS)[number]['valor'];
export type Fuso = (typeof FUSOS)[number]['valor'];
