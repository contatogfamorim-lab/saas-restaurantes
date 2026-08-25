import qrcode from 'qrcode-generator';

/**
 * QR da mesa, como SVG, gerado no SERVIDOR.
 *
 * SVG e não PNG: o adesivo da mesa vai para a gráfica, e vetor imprime nítido
 * em qualquer tamanho. PNG bom o bastante para A4 pesaria trinta vezes mais.
 *
 * No servidor e não no navegador: a folha de códigos é feita para ser impressa,
 * e página que depende de JavaScript para desenhar imprime em branco quando
 * alguém manda imprimir antes de o script rodar.
 *
 * `qrcode-generator` tem ZERO dependências. A alternativa popular (`qrcode`)
 * arrasta o `yargs` — um parser de argumentos de linha de comando — para
 * dentro de um app web.
 *
 * SEM `server-only`, de propósito: não há segredo nenhum aqui, é codificação
 * pura de uma URL. E marcar o módulo como servidor-apenas o tornaria
 * intestável no vitest, o que custaria mais do que o marcador protege — a
 * parte arriscada deste arquivo é a MINHA conversão de matriz para SVG, não a
 * biblioteca.
 */

/**
 * Correção de erro M: recupera ~15% do código danificado.
 *
 * Não é o mais alto de propósito. Adesivo de mesa vive sujo de gordura e
 * arranhado, então algum reparo é obrigatório — mas o nível H engorda a matriz,
 * o que deixa cada módulo MENOR no mesmo espaço impresso, e módulo pequeno lê
 * pior justamente na câmera ruim que se quer atender. M é o ponto em que os
 * dois erros se equilibram.
 */
const CORRECAO = 'M' as const;

export interface QrDaMesa {
  svg: string;
  url: string;
}

export function qrDaMesa(baseUrl: string, shortCode: string): QrDaMesa {
  const url = `${baseUrl.replace(/\/$/, '')}/m/${shortCode}`;

  // Tipo 0 = escolhe automaticamente o menor que couber no conteúdo.
  const qr = qrcode(0, CORRECAO);
  qr.addData(url);
  qr.make();

  const modulos = qr.getModuleCount();

  // Zona de silêncio de 4 módulos: é o mínimo da especificação do QR. Sem ela o
  // leitor não distingue onde o código termina, e o adesivo colado numa mesa de
  // madeira escura simplesmente não lê.
  const margem = 4;
  const lado = modulos + margem * 2;

  const partes: string[] = [];
  for (let linha = 0; linha < modulos; linha++) {
    for (let coluna = 0; coluna < modulos; coluna++) {
      if (qr.isDark(linha, coluna)) {
        partes.push(`M${coluna + margem} ${linha + margem}h1v1h-1z`);
      }
    }
  }

  // `shape-rendering: crispEdges` evita a borda cinza que o antialiasing cria
  // entre módulos — e é essa borda que faz leitor barato hesitar.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR da mesa">` +
    `<rect width="${lado}" height="${lado}" fill="#ffffff"/>` +
    `<path d="${partes.join('')}" fill="#000000"/>` +
    `</svg>`;

  return { svg, url };
}
