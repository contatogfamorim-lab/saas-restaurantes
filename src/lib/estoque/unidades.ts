/**
 * A conversão entre o que a cozinha digita e o que o banco guarda.
 *
 * A tela fala em gramas, mililitros e unidades. O banco guarda MILÉSIMOS, para
 * que a conta feche em inteiro — a mesma razão de o dinheiro ser em centavos.
 *
 * Mora aqui, e não dentro das actions, por dois motivos. O primeiro é que um
 * módulo `'use server'` só aceita exports assíncronos: uma função pura
 * exportada de lá quebra o build, e já quebrou neste projeto antes. O segundo é
 * melhor: sendo um módulo comum, ela pode ser testada sem banco — e esta é a
 * função em que um fator de mil errado multiplica o estoque da casa por mil.
 */

/** Milésimos da unidade base. "1,5" → 1500. Devolve null se não for número. */
export function paraMilesimos(entrada: string): number | null {
  const limpo = entrada.trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,3})?$/.test(limpo)) return null;

  // `Math.round`, e não `Math.trunc`.
  //
  // 0.29 * 1000 dá 289.99999999999994 em ponto flutuante. Truncar devolveria
  // 289 — um miligrama a menos por conversão, que numa ficha técnica repetida
  // vira diferença de estoque que ninguém explica. Arredondar acerta.
  return Math.round(Number(limpo) * 1000);
}

/** O caminho de volta, para a tela mostrar. 1500 → "1,5". */
export function deMilesimos(valor: number): string {
  const sinal = valor < 0 ? '-' : '';
  const abs = Math.abs(valor);
  const inteiro = Math.trunc(abs / 1000);
  const resto = abs % 1000;
  if (resto === 0) return `${sinal}${inteiro.toLocaleString('pt-BR')}`;
  // Zeros à direita saem: 1500 é "1,5", não "1,500" — que em português seria
  // lido como mil e quinhentos.
  const decimais = String(resto).padStart(3, '0').replace(/0+$/, '');
  return `${sinal}${inteiro.toLocaleString('pt-BR')},${decimais}`;
}

/** Reais digitados → centavos. "45,50" → 4550. */
export function paraCentavos(entrada: string): number {
  const limpo = entrada.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return 0;
  return Math.round(Number(limpo) * 100);
}

/** Como a unidade aparece na tela, junto do número. */
export const NOME_DA_UNIDADE: Record<string, string> = {
  g: 'g',
  ml: 'ml',
  un: 'un',
};

/** Como o custo é cobrado: por quilo, por litro, por cento de unidades. */
export const UNIDADE_DE_COMPRA: Record<string, string> = {
  g: 'kg',
  ml: 'L',
  un: 'mil un',
};
