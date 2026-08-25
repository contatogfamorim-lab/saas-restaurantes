/**
 * O QR da mesa (spec §14).
 *
 * O que se testa aqui NÃO é a biblioteca — `qrcode-generator` é usada há anos e
 * a codificação dela não é o risco. O risco é a conversão de matriz para SVG,
 * que é código meu: um deslocamento de um módulo, uma zona de silêncio errada
 * ou uma linha trocada por coluna produzem um SVG bonito que nenhum celular lê.
 *
 * E esse erro não aparece na tela: o quadrado continua parecendo um QR. Ele
 * aparece na mesa, no dia da inauguração.
 */
import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';

import { qrDaMesa } from '@/lib/mesas/qr';

const BASE = 'https://markello.test';
const CODIGO = 'NT4WqRcUKx';

/** Reconstrói a matriz a partir do SVG gerado, para comparar com a origem. */
function matrizDoSvg(svg: string, lado: number, margem: number): boolean[][] {
  const modulos = lado - margem * 2;
  const grade = Array.from({ length: modulos }, () => Array(modulos).fill(false));

  for (const [, x, y] of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    grade[Number(y) - margem][Number(x) - margem] = true;
  }
  return grade;
}

describe('QR da mesa', () => {
  it('a URL aponta para a mesa, sem barra dobrada', () => {
    expect(qrDaMesa(BASE, CODIGO).url).toBe(`${BASE}/m/${CODIGO}`);
    // Base com barra no fim é o caso que aparece quando alguém copia da barra
    // do navegador. `https://x.test//m/abc` funciona no HTTP mas fica feio
    // impresso embaixo do código, onde a pessoa vai DIGITAR.
    expect(qrDaMesa(`${BASE}/`, CODIGO).url).toBe(`${BASE}/m/${CODIGO}`);
  });

  it('o SVG desenha exatamente a matriz da biblioteca', () => {
    const { svg, url } = qrDaMesa(BASE, CODIGO);

    const referencia = qrcode(0, 'M');
    referencia.addData(url);
    referencia.make();
    const modulos = referencia.getModuleCount();

    const [, ladoStr] = svg.match(/viewBox="0 0 (\d+) \d+"/)!;
    const lado = Number(ladoStr);
    const margem = (lado - modulos) / 2;

    // Zona de silêncio de 4 módulos de cada lado: é o mínimo da especificação.
    // Sem ela o leitor não acha onde o código termina, e adesivo em mesa de
    // madeira escura simplesmente não lê.
    expect(margem).toBe(4);

    const desenhada = matrizDoSvg(svg, lado, margem);

    let divergencias = 0;
    for (let linha = 0; linha < modulos; linha++) {
      for (let coluna = 0; coluna < modulos; coluna++) {
        // `isDark(linha, coluna)` — linha primeiro. Trocar a ordem gera a
        // matriz TRANSPOSTA, que continua parecendo um QR e não lê.
        if (desenhada[linha][coluna] !== referencia.isDark(linha, coluna)) divergencias++;
      }
    }

    expect(divergencias, 'o SVG não corresponde à matriz').toBe(0);
  });

  it('os três marcadores de posição estão nos cantos certos', () => {
    // Se a matriz saísse espelhada ou rotacionada, a comparação acima ainda
    // passaria em um QR simétrico. Os marcadores são a assimetria: existem em
    // três cantos e NÃO no inferior direito.
    const { svg, url } = qrDaMesa(BASE, CODIGO);
    const ref = qrcode(0, 'M');
    ref.addData(url);
    ref.make();
    const n = ref.getModuleCount();

    const lado = Number(svg.match(/viewBox="0 0 (\d+)/)![1]);
    const grade = matrizDoSvg(svg, lado, 4);

    const marcador = (topo: number, esq: number) =>
      grade[topo][esq] && grade[topo][esq + 6] && grade[topo + 6][esq] &&
      !grade[topo + 1][esq + 1];

    expect(marcador(0, 0), 'canto superior esquerdo').toBe(true);
    expect(marcador(0, n - 7), 'canto superior direito').toBe(true);
    expect(marcador(n - 7, 0), 'canto inferior esquerdo').toBe(true);

    // O canto inferior direito NÃO tem marcador — é essa ausência que diz ao
    // leitor qual é a orientação do código.
    //
    // A asserção testa a ESTRUTURA de 7x7, e não um módulo solto: a primeira
    // versão conferia `grade[n-7][n-7] === false` e reprovou o código certo,
    // porque ali passa o padrão de alinhamento e um módulo escuro naquele
    // ponto é perfeitamente normal.
    expect(marcador(n - 7, n - 7), 'não pode haver marcador no canto inferior direito').toBe(false);
  });

  it('códigos diferentes geram QRs diferentes', () => {
    const a = qrDaMesa(BASE, 'AAAAAAAAAA');
    const b = qrDaMesa(BASE, 'BBBBBBBBBB');
    expect(a.svg).not.toBe(b.svg);
  });
});
