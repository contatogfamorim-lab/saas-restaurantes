/**
 * O que o prato É, deduzido do nome — e o tamanho típico do que ele é servido.
 *
 * Duas coisas dependem disto e por isso ele mora num lugar só:
 *
 *   • o seed de desenvolvimento, que escolhe qual modelo procedural usar;
 *   • o gerador de verdade, que precisa de uma largura em centímetros para
 *     encaixar a escala do modelo que voltou do serviço.
 *
 * Enquanto eram duas listas, elas divergiam — e divergir aqui significa o mesmo
 * prato aparecendo com um modelo no card e outro tamanho no AR.
 *
 * A ORDEM DAS REGRAS É O CONTEÚDO, NÃO A ORGANIZAÇÃO
 *
 * Nome de prato de restaurante é cheio de ingrediente compartilhado. "Fritas
 * com Cheddar e Bacon" contém "bacon" e virou hambúrguer na primeira versão;
 * "Smash Duplo" bateu em "trinca" antes de bater em "duplo". Por isso as regras
 * de TIPO vêm antes das de INGREDIENTE, e a primeira que casar vence.
 */

export interface TipoDePrato {
  /** Nome do modelo procedural correspondente, para o seed. */
  modelo: string;
  /**
   * Largura típica em centímetros — a maior dimensão horizontal do conjunto
   * montado, louça incluída. É o palpite usado enquanto ninguém mediu o prato
   * de verdade, e é sempre marcado como estimativa no banco.
   */
  larguraCm: number;
}

const REGRAS: Array<[RegExp, TipoDePrato]> = [
  // Porções: prato raso ou cumbuca
  [/rustica|mandioca/, { modelo: 'fritas-2', larguraCm: 15 }],
  [/frita|batata/, { modelo: 'fritas-1', larguraCm: 15 }],
  [/onion|anel|aneis/, { modelo: 'aneis', larguraCm: 24 }],
  [/passarinho/, { modelo: 'empanados-2', larguraCm: 24 }],
  [/nugget/, { modelo: 'empanados-3', larguraCm: 24 }],
  [/isca|calabresa/, { modelo: 'empanados-1', larguraCm: 24 }],

  // Bebidas: copo ou garrafa. "Long neck" antes de "cerveja", senão o long
  // neck vira copo.
  [/long neck/, { modelo: 'garrafa-2', larguraCm: 6.2 }],
  [/agua mineral|agua sem gas|agua com gas/, { modelo: 'garrafa-1', larguraCm: 6.8 }],
  [/chopp/, { modelo: 'bebida-1', larguraCm: 7.5 }],
  [/refrigerante|refri|coca|guarana/, { modelo: 'bebida-2', larguraCm: 7 }],
  [/suco/, { modelo: 'bebida-3', larguraCm: 7 }],
  [/limonada/, { modelo: 'bebida-4', larguraCm: 7 }],
  [/cerveja/, { modelo: 'garrafa-2', larguraCm: 6.2 }],

  // Sobremesas
  [/milkshake|shake/, { modelo: 'milkshake', larguraCm: 7.6 }],
  [/petit|gateau/, { modelo: 'sobremesa-1', larguraCm: 22 }],
  [/brownie|sorvete/, { modelo: 'sobremesa-2', larguraCm: 22 }],
  [/cheesecake|torta|fatia|pudim/, { modelo: 'fatia', larguraCm: 22 }],

  // Burgers por último, do mais específico ao mais genérico: "Smash Duplo"
  // precisa bater em "duplo" antes de cair no "smash".
  [/trinca/, { modelo: 'burger-trinca', larguraCm: 26 }],
  [/duplo/, { modelo: 'burger-2', larguraCm: 26 }],
  [/bacon/, { modelo: 'burger-bacon', larguraCm: 26 }],
  [/cogumelo/, { modelo: 'burger-cogumelo', larguraCm: 26 }],
  [/frango/, { modelo: 'burger-3', larguraCm: 26 }],
  [/veggie|grao|vegetariano/, { modelo: 'burger-4', larguraCm: 26 }],
  [/kids|infantil/, { modelo: 'burger-kids', larguraCm: 24 }],
  [/smash|burger|picanha|costela|salada/, { modelo: 'burger-1', larguraCm: 26 }],

  // Tipos que o catálogo cobre e o cardápio de teste não tem
  [/pizza/, { modelo: 'pizza', larguraCm: 30 }],
  [/sopa|caldo|ramen|creme/, { modelo: 'caldo', larguraCm: 16 }],
];

/** Rede para o prato cujo nome não casou com nenhuma regra. */
const POR_CATEGORIA: Record<string, TipoDePrato> = {
  Burgers: { modelo: 'burger-1', larguraCm: 26 },
  'Pra dividir': { modelo: 'fritas-1', larguraCm: 15 },
  'Happy Hour': { modelo: 'bebida-1', larguraCm: 7.5 },
  Bebidas: { modelo: 'bebida-2', larguraCm: 7 },
  Sobremesas: { modelo: 'sobremesa-1', larguraCm: 22 },
};

/** Prato raso de 26 cm: o mais comum de restaurante, e o menos errado de chutar. */
const PADRAO: TipoDePrato = { modelo: 'burger-1', larguraCm: 26 };

/** Sem acento e em minúsculas, para as regras não dependerem de digitação. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function tipoDoPrato(nome: string, categoria?: string): TipoDePrato {
  const limpo = normalizar(nome);

  for (const [regra, tipo] of REGRAS) {
    if (regra.test(limpo)) return tipo;
  }

  return (categoria ? POR_CATEGORIA[categoria] : undefined) ?? PADRAO;
}
