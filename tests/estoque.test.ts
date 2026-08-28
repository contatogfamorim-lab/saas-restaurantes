/**
 * Conversão de unidades (`lib/estoque/unidades`).
 *
 * É a função em que um fator de mil errado multiplica o estoque da casa por
 * mil — e o erro não apareceria como tela quebrada, e sim como 45 toneladas de
 * carne na câmara fria.
 */
import { describe, expect, it } from 'vitest';

import { deMilesimos, paraCentavos, paraMilesimos } from '@/lib/estoque/unidades';

describe('para milésimos', () => {
  it('o número inteiro é multiplicado por mil', () => {
    expect(paraMilesimos('150')).toBe(150_000);
    expect(paraMilesimos('1')).toBe(1000);
    expect(paraMilesimos('0')).toBe(0);
  });

  it('aceita vírgula, que é como se escreve em português', () => {
    expect(paraMilesimos('1,5')).toBe(1500);
    expect(paraMilesimos('0,5')).toBe(500);
    expect(paraMilesimos('2,25')).toBe(2250);
  });

  it('arredonda em vez de truncar', () => {
    // 0.29 * 1000 dá 289.99999999999994 em ponto flutuante. Truncar devolveria
    // 289 — um miligrama a menos por conversão.
    expect(paraMilesimos('0,29')).toBe(290);
    expect(paraMilesimos('0,1')).toBe(100);
    expect(paraMilesimos('8,29')).toBe(8290);
  });

  it('recusa o que não é número', () => {
    expect(paraMilesimos('')).toBeNull();
    expect(paraMilesimos('abc')).toBeNull();
    expect(paraMilesimos('1,2,3')).toBeNull();
    // Mais de três casas não cabe em milésimo, e arredondar em silêncio seria
    // aceitar um número e guardar outro.
    expect(paraMilesimos('0,0001')).toBeNull();
  });

  it('aceita negativo — a contagem pode achar menos', () => {
    expect(paraMilesimos('-2,5')).toBe(-2500);
  });
});

describe('de volta para a tela', () => {
  it('mostra sem casas quando é redondo', () => {
    expect(deMilesimos(150_000)).toBe('150');
    expect(deMilesimos(1000)).toBe('1');
    expect(deMilesimos(0)).toBe('0');
  });

  it('corta zeros à direita', () => {
    // 1500 é "1,5" e não "1,500" — que em português se lê como mil e quinhentos.
    expect(deMilesimos(1500)).toBe('1,5');
    expect(deMilesimos(2250)).toBe('2,25');
    expect(deMilesimos(500)).toBe('0,5');
  });

  it('separa milhar à brasileira', () => {
    expect(deMilesimos(45_000_000)).toBe('45.000');
    expect(deMilesimos(1_500_000)).toBe('1.500');
  });

  it('o negativo aparece como negativo', () => {
    expect(deMilesimos(-150_000)).toBe('-150');
    expect(deMilesimos(-1500)).toBe('-1,5');
  });

  it('ida e volta não perde nada', () => {
    for (const v of ['150', '1,5', '0,29', '45.000', '2,25']) {
      const ida = paraMilesimos(v.replace('.', ''));
      expect(ida).not.toBeNull();
      expect(paraMilesimos(deMilesimos(ida!).replace('.', ''))).toBe(ida);
    }
  });
});

describe('reais para centavos', () => {
  it('converte o que a pessoa digita', () => {
    expect(paraCentavos('45,00')).toBe(4500);
    expect(paraCentavos('45')).toBe(4500);
    expect(paraCentavos('0,05')).toBe(5);
  });

  it('o que não for número vira zero, não NaN', () => {
    // Zero é um custo válido — "não sei quanto custa". NaN entraria no banco
    // como erro de tipo, no meio de um formulário.
    expect(paraCentavos('')).toBe(0);
    expect(paraCentavos('abc')).toBe(0);
  });
});
