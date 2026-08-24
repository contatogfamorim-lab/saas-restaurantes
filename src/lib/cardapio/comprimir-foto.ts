'use client';

/**
 * Prepara a foto do prato ANTES de subir (spec §13.2).
 *
 * A §13.2 pede foto de até 50 KB, em AVIF ou WebP, e manda nunca servir o
 * upload original. A forma mais direta de cumprir a última parte é o original
 * não chegar ao servidor: o corte, o redimensionamento e a conversão acontecem
 * aqui, no navegador de quem escolheu o arquivo. O que sobe já é a versão que
 * o cliente vai ver.
 *
 * De quebra resolve o problema prático: a foto sai de um celular com 4 MB e
 * 4000 px de largura. Subir isso numa conexão de restaurante demora, e o
 * egress da §13.2 é medido no nosso plano.
 *
 * WEBP E NÃO AVIF
 *
 * AVIF comprime melhor, mas `canvas.toBlob('image/avif')` não é suportado em
 * boa parte dos navegadores — e onde não é, o `toBlob` devolve PNG em silêncio,
 * sem avisar. Um PNG de 4000 px "convertido" viraria um arquivo maior que o
 * original. WebP é suportado em todos os alvos e o resultado é conferido no
 * fim, não presumido.
 */

/** Alvo da §13.2. */
export const ALVO_BYTES = 50 * 1024;

/**
 * Cobre o maior uso real com folga: a foto grande do bottom sheet ocupa ~375
 * CSS px, e em tela 2x isso dá 750. Acima disso são pixels que ninguém vê e
 * bytes que todo mundo paga.
 */
const LARGURA_MAX = 820;

/** Da melhor para a pior. Quem sair abaixo do alvo primeiro vence. */
const QUALIDADES = [0.82, 0.72, 0.62, 0.52, 0.42];

export interface FotoPronta {
  arquivo: File;
  bytes: number;
  largura: number;
  altura: number;
}

export class FotoInvalida extends Error {}

export async function comprimirFoto(original: File): Promise<FotoPronta> {
  if (!original.type.startsWith('image/')) {
    throw new FotoInvalida('Escolha uma imagem.');
  }

  const bitmap = await carregarBitmap(original);

  try {
    const escala = Math.min(1, LARGURA_MAX / bitmap.width);
    const largura = Math.round(bitmap.width * escala);
    const altura = Math.round(bitmap.height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new FotoInvalida('Este navegador não conseguiu processar a imagem.');

    // Fundo branco antes de desenhar: PNG com transparência viraria preto ao
    // achatar em WebP com fundo indefinido, e foto de hambúrguer com halo
    // preto é pior que foto nenhuma.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(bitmap, 0, 0, largura, altura);

    let melhor: Blob | null = null;

    for (const qualidade of QUALIDADES) {
      const blob = await paraBlob(canvas, qualidade);

      // `toBlob` cai para PNG quando o formato não é suportado, e cai calado.
      // Sem esta conferência, um navegador sem WebP subiria PNG achando que
      // cumpriu a §13.2.
      if (blob.type !== 'image/webp') {
        throw new FotoInvalida(
          'Este navegador não gera WebP. Suba a foto por outro aparelho.',
        );
      }

      melhor = blob;
      if (blob.size <= ALVO_BYTES) break;
    }

    if (!melhor) throw new FotoInvalida('Não foi possível processar a imagem.');

    // Chegou na pior qualidade e ainda passou do alvo: acontece com foto de
    // muito detalhe fino. Melhor dizer do que subir 180 KB dizendo que são 50.
    if (melhor.size > ALVO_BYTES) {
      throw new FotoInvalida(
        `A foto ficou em ${Math.round(melhor.size / 1024)} KB mesmo comprimida ` +
          `(o limite é ${ALVO_BYTES / 1024} KB). Tente uma imagem mais simples ou com menos textura.`,
      );
    }

    return {
      arquivo: new File([melhor], `${crypto.randomUUID()}.webp`, { type: 'image/webp' }),
      bytes: melhor.size,
      largura,
      altura,
    };
  } finally {
    bitmap.close?.();
  }
}

async function carregarBitmap(arquivo: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(arquivo);
  } catch {
    // Arquivo com extensão de imagem que não é imagem, ou formato que o
    // navegador não decodifica (HEIC de iPhone antigo, por exemplo).
    throw new FotoInvalida('Não consegui abrir esta imagem. Tente JPG ou PNG.');
  }
}

function paraBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new FotoInvalida('Falha ao converter a imagem.'))),
      'image/webp',
      qualidade,
    );
  });
}
