import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  draco,
  getBounds,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// Com extensão `.ts` de propósito: o bundler do Next resolve sem ela, o Node
// ESM não — e este arquivo é importado pelos dois. Sem a extensão, o comando
// `modelos:gerar` morre antes de fazer nada, com um ERR_MODULE_NOT_FOUND que
// aponta para um caminho que existe.
import { limparBase } from './limpar-base.ts';

/**
 * O que separa "o gerador cuspiu uma malha" de "isto é um prato do cardápio".
 *
 * O modelo que volta de qualquer gerador vem numa caixa arbitrária, com a
 * origem em qualquer lugar e sem compressão. Três coisas precisam acontecer
 * antes de ele virar arquivo servido:
 *
 * ESCALA — glTF é definido em METROS, e o AR promete o tamanho verdadeiro do
 * prato. O gerador não sabe se aquilo tem 12 ou 30 cm: para ele é um objeto
 * normalizado. Se ninguém encaixar a escala, o hambúrguer chega à mesa do
 * cliente do tamanho de uma poltrona. É o defeito mais silencioso do AR e o
 * mais constrangedor.
 *
 * ORIGEM — tem que ficar na BASE, centrada. Com o pivô no centro geométrico o
 * prato afunda meio dedo na mesa; deslocado, ele pousa ao lado do ponto tocado.
 *
 * PESO — o gerador entrega no mínimo 100 mil triângulos com textura de 1024,
 * porque é o piso dos controles dele. Isso é ordens de grandeza acima do que um
 * card de 230 px consome. A redução acontece aqui, e em dois níveis a partir do
 * MESMO arquivo denso: a geração é a parte cara, e baixá-la uma vez para
 * derivar os dois é o que evita pagar duas.
 */

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

export interface Acabado {
  glb: Uint8Array;
  /** Maior dimensão horizontal depois da escala, em centímetros. */
  larguraCm: number;
  /** Altura depois da escala, em centímetros. Serve para conferir o resultado. */
  alturaCm: number;
  /** Triângulos que sobraram depois da simplificação. */
  triangulos: number;
  /** Quantos triângulos de mesa foram descartados antes de medir. */
  mesaRemovida: number;
}

export interface Nivel {
  /** Fração dos triângulos originais a manter. 0.04 de 100 mil dá ~4 mil. */
  proporcao: number;
  /** Lado da textura, em pixels. */
  textura: number;
}

/**
 * Os dois níveis do cardápio.
 *
 * `card` é o que roda na lista, num quadro de ~230 px: 4 mil triângulos e
 * textura de 256 são generosos para esse tamanho, e a diferença para o hero é
 * invisível ali. `hero` é o que abre em tela cheia e vai para o AR, onde o
 * prato ocupa a tela inteira e o cliente aproxima.
 */
export const NIVEIS = {
  card: { proporcao: 0.04, textura: 256 },
  hero: { proporcao: 0.2, textura: 1024 },
} as const satisfies Record<string, Nivel>;

/**
 * Encaixa a escala, põe a origem na base, simplifica e comprime.
 *
 * `larguraCm` é a maior dimensão HORIZONTAL do prato montado — a medida que o
 * dono consegue dar, seja escolhendo a louça, seja pelo objeto de referência na
 * foto. A altura sai proporcional: reescalar os eixos separadamente deformaria
 * o prato, e um hambúrguer achatado é pior que um hambúrguer do tamanho errado.
 */
export async function acabar(
  glb: Uint8Array,
  larguraCm: number,
  nivel: Nivel,
): Promise<Acabado> {
  const documento = await io.readBinary(glb);
  const cena = documento.getRoot().listScenes()[0];
  if (!cena) throw new Error('GLB sem cena');

  // A MESA SAI ANTES DE QUALQUER MEDIDA.
  //
  // A ordem aqui é o que importa: se a limpeza viesse depois da escala, a
  // largura teria sido encaixada na mesa em vez de no prato — foi assim que o
  // chopp saiu com 7,5 cm de largura e 4,1 de altura, medidas de uma poça.
  const limpeza = limparBase(documento);

  const caixa = getBounds(cena);
  const largura = Math.max(caixa.max[0] - caixa.min[0], caixa.max[2] - caixa.min[2]);
  if (!(largura > 0)) throw new Error('GLB com caixa degenerada');

  const escala = larguraCm / 100 / largura;

  // A transformação entra num nó NOVO por cima de tudo, em vez de ser aplicada
  // vértice a vértice. É reversível, não toca nos buffers (que serão
  // comprimidos logo em seguida) e não estraga normais — reescalar geometria à
  // mão exige recalcular normais, e ninguém lembra disso até a iluminação sair
  // errada.
  const base = documento.createNode('base').setScale([escala, escala, escala]);

  for (const filho of cena.listChildren()) {
    cena.removeChild(filho);
    base.addChild(filho);
  }
  cena.addChild(base);

  // Só agora dá para medir onde ficou o chão, porque a escala já entrou.
  const depois = getBounds(cena);
  base.setTranslation([
    -(depois.min[0] + depois.max[0]) / 2,
    -depois.min[1],
    -(depois.min[2] + depois.max[2]) / 2,
  ]);

  await documento.transform(
    // `weld` funde vértices repetidos, e vem ANTES do `simplify` por
    // necessidade: o simplificador trabalha sobre a topologia, e malha cujos
    // triângulos não compartilham vértices não tem topologia — ele não teria o
    // que colapsar e devolveria a malha intacta.
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: nivel.proporcao, error: 0.001 }),

    // A textura costuma ser a maior parte do arquivo, não a geometria. Reduzir
    // a malha sem reduzir a imagem resolve metade do problema.
    //
    // WEBP, e a diferença não é pequena: o mesmo prato sai com 739 KB em WebP
    // contra 4,9 MB em PNG.
    //
    // Cheguei a culpar o WebP quando o prato apareceu branco no cardápio, e
    // troquei para PNG por precaução. Estava errado: a textura não carregava
    // por causa da CSP, que não permitia `blob:` em `connect-src` — o
    // `GLTFLoader` extrai as imagens embutidas para blob e as busca com
    // `fetch`. Corrigido em `src/proxy.ts`, o WebP funciona igual.
    //
    // Fica registrado porque a tentação de "trocar o formato e ver se resolve"
    // vai voltar: o sintoma aponta para o arquivo, e o defeito estava no
    // cabeçalho.
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [nivel.textura, nivel.textura],
    }),

    dedup(),
    prune(),
    draco({ method: 'edgebreaker' }),
  );

  const final = getBounds(documento.getRoot().listScenes()[0]);

  let triangulos = 0;
  for (const malha of documento.getRoot().listMeshes()) {
    for (const prim of malha.listPrimitives()) {
      const indices = prim.getIndices();
      triangulos += indices
        ? indices.getCount() / 3
        : (prim.getAttribute('POSITION')?.getCount() ?? 0) / 3;
    }
  }

  return {
    glb: await io.writeBinary(documento),
    larguraCm: arredondar(
      Math.max(final.max[0] - final.min[0], final.max[2] - final.min[2]) * 100,
    ),
    alturaCm: arredondar((final.max[1] - final.min[1]) * 100),
    triangulos: Math.round(triangulos),
    mesaRemovida: limpeza.triangulos,
  };
}

function arredondar(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Faixa plausível para prato de restaurante, em centímetros.
 *
 * Entre um copo de cafezinho e uma travessa de família. Fora disso é erro de
 * unidade — o defeito clássico do AR, e o único que ninguém percebe olhando o
 * card: no cardápio o enquadramento é derivado do objeto, então o prato aparece
 * bonito do mesmo jeito. Só na mesa do cliente é que ele vira uma poltrona.
 */
export const FAIXA_PLAUSIVEL = { min: 4, max: 80 } as const;

export function conferirEscala(a: Acabado, nome: string): void {
  if (a.larguraCm < FAIXA_PLAUSIVEL.min || a.larguraCm > FAIXA_PLAUSIVEL.max) {
    throw new Error(
      `${nome}: largura de ${a.larguraCm} cm está fora do plausível ` +
        `(${FAIXA_PLAUSIVEL.min}–${FAIXA_PLAUSIVEL.max} cm). Provável erro de unidade.`,
    );
  }
}

/** Só para o gerador não precisar importar o `Document` do gltf-transform. */
export type { Document };
