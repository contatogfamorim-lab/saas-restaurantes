/**
 * Dinheiro é SEMPRE integer em centavos (spec P7). Nunca float.
 *
 * O único lugar do sistema onde centavos viram string. Toda aritmética
 * acontece antes daqui, em inteiro — `0.1 + 0.2 !== 0.3` não pode encostar
 * numa conta de restaurante.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const BRL_SEM_SIMBOLO = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 4200 → "R$ 42,00" */
export function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}

/** 4200 → "42,00" — para quando o "R$" já está na coluna ao lado */
export function formatCentsBare(cents: number): string {
  return BRL_SEM_SIMBOLO.format(cents / 100);
}

/**
 * Lê o que o caixa digitou e devolve CENTAVOS inteiros.
 *
 * Aceita "42,50", "42.50", "4250" e "R$ 42,50". Devolve `null` para lixo — que
 * é diferente de zero, e o chamador precisa distinguir: campo vazio não é
 * pagamento de zero reais.
 *
 * A conversão passa por string, não por `parseFloat * 100`: `42.55 * 100` dá
 * 4254.999... em ponto flutuante, e um centavo perdido por conta é um centavo
 * que ninguém consegue explicar no fechamento do mês.
 */
export function parseCents(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, '').trim();
  if (!limpo || limpo.includes('-')) return null;

  // O último separador é o decimal; os outros são de milhar.
  const ultimoSeparador = Math.max(limpo.lastIndexOf(','), limpo.lastIndexOf('.'));

  if (ultimoSeparador === -1) {
    const inteiro = limpo.replace(/\D/g, '');
    if (!inteiro) return null;
    // sem separador, o número digitado são REAIS
    return Number(inteiro) * 100;
  }

  const reais = limpo.slice(0, ultimoSeparador).replace(/\D/g, '');
  const centavos = limpo.slice(ultimoSeparador + 1).replace(/\D/g, '');

  if (centavos.length > 2) return null;

  return Number(reais || '0') * 100 + Number(centavos.padEnd(2, '0'));
}

/**
 * Percentual de desconto ARREDONDADO PARA BAIXO.
 *
 * De R$ 46 por R$ 39 dá 15,2% — o selo mostra "-15%", nunca "-16%".
 * Arredondar para cima infla o desconto anunciado, e anunciar desconto maior
 * do que o praticado é publicidade enganosa (CDC art. 37), com a
 * responsabilidade caindo no restaurante (spec §4).
 */
export function discountPercent(fromCents: number, toCents: number): number {
  if (fromCents <= 0 || toCents >= fromCents) return 0;
  return Math.floor(((fromCents - toCents) / fromCents) * 100);
}
