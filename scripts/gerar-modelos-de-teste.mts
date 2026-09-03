/**
 * Exporta os pratos procedurais como GLB, para alimentar o carregador do palco.
 *
 * Enquanto a digitalização não existe, o palco precisa de arquivo de verdade
 * para exercitar o caminho que importa: buscar pela rede, decodificar, medir o
 * peso, trocar o modelo leve pelo pesado. Prato montado em memória não testa
 * nada disso — ele já nasce do outro lado do problema.
 *
 * Dois níveis por receita, que é o desenho do cardápio:
 *
 *   card — o que aparece na lista rolando, leve
 *   hero — o que abre em tela cheia e vai para o AR, caro
 *
 * Saem em `public/modelos-de-teste/`, servidos como arquivo estático. Modelo de
 * verdade vai morar no Storage do Supabase; estes são andaime.
 *
 * COMPRESSÃO
 *
 * glTF cru guarda posição e normal em float32: 24 bytes por vértice só de
 * geometria, para uma comida cujo detalhe cabe folgado em 14 bits. O primeiro
 * hambúrguer saiu com 150 KB para 5 mil triângulos — mais caro que a foto que
 * ele deveria substituir.
 *
 * Draco requantiza e comprime a mesma malha. O preço é do outro lado: o
 * navegador precisa de um decodificador WASM, e WASM é governado pelo
 * `script-src` da CSP — daí o `wasm-unsafe-eval` em `src/proxy.ts`.
 *
 *   node scripts/gerar-modelos-de-teste.mts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// O exportador do Three usa `FileReader` para transformar Blob em ArrayBuffer.
// O Node tem Blob desde a 18, mas nunca teve FileReader global. O caminho que
// o exportador percorre é um só — `readAsArrayBuffer` e o callback de término —
// então o remendo é do tamanho do buraco, e não uma implementação do padrão.
if (!('FileReader' in globalThis)) {
  class FileReaderRemendado {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;

    readAsArrayBuffer(blob: Blob): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          this.onloadend?.();
        })
        .catch((e) => this.onerror?.(e));
    }
  }
  Object.assign(globalThis, { FileReader: FileReaderRemendado });
}

const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

const { NodeIO } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const { draco, dedup, prune, weld } = await import('@gltf-transform/functions');
const draco3d = (await import('draco3dgltf')).default;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

/** Passa a malha pelo moedor e devolve o GLB comprimido. */
async function comprimir(glb: ArrayBuffer): Promise<Uint8Array> {
  const documento = await io.readBinary(new Uint8Array(glb));

  await documento.transform(
    // `weld` funde vértices repetidos: sem isso cada triângulo carrega os três
    // vértices só para si, e o Draco comprime três vezes o mesmo ponto.
    weld(),
    dedup(),
    prune(),
    draco({ method: 'edgebreaker' }),
  );

  return io.writeBinary(documento);
}
const { pratoDeTeste, CATALOGO } = await import('../src/lib/palco/pratos-de-teste.ts');

const DESTINO = join(import.meta.dirname, '..', 'public', 'modelos-de-teste');

/** `card` é o que rola na lista; `hero` é o que vai para o AR. */
const NIVEIS = [
  { sufixo: 'card', detalhe: 1 },
  { sufixo: 'hero', detalhe: 4 },
] as const;

await mkdir(DESTINO, { recursive: true });

const exportador = new GLTFExporter();
let total = 0;

for (const entrada of CATALOGO) {
  for (const { sufixo, detalhe } of NIVEIS) {
    const { objeto, triangulos } = pratoDeTeste(entrada.nome, detalhe);

    const glb = (await exportador.parseAsync(objeto, {
      binary: true,
      // Sem `onlyVisible` o exportador carrega junto o que estiver escondido, e
      // sem truncar as normais o arquivo dobra sem ninguém ver diferença.
      onlyVisible: true,
      truncateDrawRange: true,
    })) as ArrayBuffer;

    const comprimido = await comprimir(glb);

    const arquivo = `${entrada.nome}-${sufixo}.glb`;
    await writeFile(join(DESTINO, arquivo), comprimido);

    total += comprimido.byteLength;
    const antes = (glb.byteLength / 1024).toFixed(0);
    const depois = (comprimido.byteLength / 1024).toFixed(1);
    console.log(
      `  ${arquivo.padEnd(24)} ${depois.padStart(7)} KB  (de ${antes} KB)  ` +
        `${triangulos.toLocaleString('pt-BR')} triângulos`,
    );
  }
}

console.log(
  `\n${CATALOGO.length * NIVEIS.length} arquivos, ${(total / 1024).toFixed(1)} KB no total ` +
    `(${(total / 1024 / CATALOGO.length).toFixed(0)} KB por prato, card + hero).`,
);
