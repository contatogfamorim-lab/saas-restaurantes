import type { Document } from '@gltf-transform/core';
import { compactPrimitive } from '@gltf-transform/functions';

/**
 * Tira do modelo a MESA que o gerador reconstruiu junto com o prato.
 *
 * O PROBLEMA, EM UMA FRASE
 *
 * Foto de comida é comida em cima de alguma coisa. O gerador não sabe onde
 * termina o prato e começa o tampo — ainda mais quando o tampo é escuro e
 * reflexivo, que é metade das fotos de cardápio — e devolve uma lâmina larga e
 * fina grudada na base do objeto. No primeiro teste, a caneca de chopp veio com
 * um disco de mesa mais largo que a própria caneca.
 *
 * Isso estraga três coisas de uma vez: o card fica dominado por uma poça
 * cinzenta, o enquadramento recua para caber a poça e a comida encolhe, e a
 * escala é aplicada à largura da poça — foi assim que um chopp saiu com 7,5 cm
 * de largura e 4,1 de altura.
 *
 * COMO A ABA É RECONHECIDA
 *
 * Ela tem uma assinatura geométrica clara: fica colada no chão do modelo e é
 * MUITO mais larga que o corpo logo acima. Então:
 *
 *   1. mede-se o raio do corpo — a distância ao eixo vertical dos vértices que
 *      estão acima da faixa da base;
 *   2. mede-se o raio na faixa da base;
 *   3. se o segundo for muito maior que o primeiro, existe aba;
 *   4. os triângulos que estão na base E fora do raio do corpo saem.
 *
 * O eixo vertical é calculado com os vértices DO CORPO, não com a caixa
 * envolvente inteira: a aba costuma ser assimétrica e puxaria o centro para
 * fora, fazendo o corte comer um lado do prato e deixar o outro.
 *
 * QUANDO NÃO FAZER NADA
 *
 * Pizza, tábua e fatia SÃO naturalmente largas e baixas. Confundi-las com aba
 * cortaria o prato em vez de limpá-lo — um erro bem pior que o que se está
 * corrigindo. Por isso a limpeza só age quando a diferença é gritante e quando
 * existe corpo de verdade acima da base. Na dúvida, o modelo sai intacto.
 */

/**
 * Os quatro números que governam o corte, calibráveis por ambiente.
 *
 * Ficam expostos porque acertá-los é trabalho de olho, não de dedução: cada
 * ajuste precisa ser visto num prato de verdade. Com variável de ambiente dá
 * para varrer uma faixa de valores num laço, sobre um arquivo já baixado, sem
 * gastar um segundo de GPU.
 *
 * Os padrões são os que removeram a mesa da caneca de chopp sem tocar no copo:
 * 49% de largura a menos, 7.977 triângulos fora. Valores mais agressivos foram
 * testados e não encontraram mais nada para cortar — o que sobra na base do
 * copo é a espuma que o próprio gerador reconstruiu, não a mesa, e apertar mais
 * passaria a comer o prato.
 */
const num = (nome: string, padrao: number) => Number(process.env[nome] ?? padrao);

/** Fração da altura considerada "base". */
const FAIXA_BASE = num('LIMPEZA_FAIXA_BASE', 0.12);

/** Acima disto é "corpo" — o que define o raio de referência. */
const FAIXA_CORPO = num('LIMPEZA_FAIXA_CORPO', 0.3);

/** A base precisa ser tantas vezes mais larga que o corpo para haver aba. */
const LIMIAR = num('LIMPEZA_LIMIAR', 1.6);

/** Folga sobre o raio do corpo, para não raspar a borda legítima do prato. */
const FOLGA = num('LIMPEZA_FOLGA', 1.15);

/** Mínimo de vértices no corpo para o objeto não ser considerado plano. */
const CORPO_MINIMO = 0.15;

export interface Limpeza {
  removeu: boolean;
  /** Triângulos descartados. */
  triangulos: number;
  /** Quanto a largura encolheu, em porcentagem. */
  encolheu: number;
}

export function limparBase(documento: Document): Limpeza {
  let removidos = 0;
  let larguraAntes = 0;
  let larguraDepois = 0;

  for (const malha of documento.getRoot().listMeshes()) {
    for (const prim of malha.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;

      const n = pos.getCount();
      const v = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const p = pos.getElement(i, [0, 0, 0]);
        v[i * 3] = p[0];
        v[i * 3 + 1] = p[1];
        v[i * 3 + 2] = p[2];
      }

      let yMin = Infinity;
      let yMax = -Infinity;
      for (let i = 0; i < n; i++) {
        const y = v[i * 3 + 1];
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }

      const altura = yMax - yMin;
      if (!(altura > 0)) continue;

      // Eixo vertical a partir do CORPO, não da caixa inteira.
      let sx = 0;
      let sz = 0;
      let corpo = 0;
      for (let i = 0; i < n; i++) {
        if ((v[i * 3 + 1] - yMin) / altura <= FAIXA_CORPO) continue;
        sx += v[i * 3];
        sz += v[i * 3 + 2];
        corpo++;
      }

      // Objeto naturalmente plano (pizza, fatia, tábua): não há corpo acima da
      // base para servir de referência, e qualquer corte seria chute.
      if (corpo / n < CORPO_MINIMO) continue;

      const cx = sx / corpo;
      const cz = sz / corpo;

      const raio = (i: number) => Math.hypot(v[i * 3] - cx, v[i * 3 + 2] - cz);

      const raiosCorpo: number[] = [];
      const raiosBase: number[] = [];
      for (let i = 0; i < n; i++) {
        const yn = (v[i * 3 + 1] - yMin) / altura;
        if (yn > FAIXA_CORPO) raiosCorpo.push(raio(i));
        else if (yn < FAIXA_BASE) raiosBase.push(raio(i));
      }
      if (raiosCorpo.length === 0 || raiosBase.length === 0) continue;

      const rCorpo = percentil(raiosCorpo, 0.9);
      const rBase = percentil(raiosBase, 0.98);
      if (!(rBase > rCorpo * LIMIAR)) continue; // sem aba, nada a fazer

      const corte = rCorpo * FOLGA;
      const naAba = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const yn = (v[i * 3 + 1] - yMin) / altura;
        naAba[i] = yn < FAIXA_BASE && raio(i) > corte ? 1 : 0;
      }

      // Só cai o triângulo com os TRÊS vértices na aba. Assim a faixa de
      // transição — onde o prato encosta na mesa — fica com a geometria do
      // prato, e o corte não abre buraco na base.
      const manter: number[] = [];
      for (let t = 0; t < idx.getCount(); t += 3) {
        const a = idx.getScalar(t);
        const b = idx.getScalar(t + 1);
        const c = idx.getScalar(t + 2);
        if (naAba[a] && naAba[b] && naAba[c]) {
          removidos++;
          continue;
        }
        manter.push(a, b, c);
      }

      if (removidos === 0) continue;

      larguraAntes = Math.max(larguraAntes, rBase * 2);
      idx.setArray(new Uint32Array(manter));

      // Tira os vértices que ficaram sem nenhum triângulo. Sem isto eles
      // continuam no buffer, pesando bytes e — pior — mantendo a caixa
      // envolvente antiga, que é justamente o que se quis corrigir.
      compactPrimitive(prim);

      const pos2 = prim.getAttribute('POSITION')!;
      let r2 = 0;
      for (let i = 0; i < pos2.getCount(); i++) {
        const p = pos2.getElement(i, [0, 0, 0]);
        r2 = Math.max(r2, Math.hypot(p[0] - cx, p[2] - cz));
      }
      larguraDepois = Math.max(larguraDepois, r2 * 2);
    }
  }

  return {
    removeu: removidos > 0,
    triangulos: removidos,
    encolheu:
      larguraAntes > 0 ? Math.round((1 - larguraDepois / larguraAntes) * 100) : 0,
  };
}

function percentil(valores: number[], p: number): number {
  const ordenado = [...valores].sort((a, b) => a - b);
  return ordenado[Math.min(ordenado.length - 1, Math.floor(ordenado.length * p))];
}
