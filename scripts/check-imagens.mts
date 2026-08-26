/**
 * Toda imagem tem de caber na CSP.
 *
 * O PROBLEMA QUE ISTO EXISTE PARA PEGAR
 *
 * A CSP deste projeto é `img-src 'self' blob: data:` (ver `src/proxy.ts`).
 * Endereço do Supabase Storage NÃO é 'self'. Um `<img src={urlDoStorage}>` é
 * bloqueado — e bloqueado em SILÊNCIO, do ponto de vista de quem olha a página:
 * o elemento fica `complete: true` com `naturalWidth: 0`, sem buraco, sem ícone
 * de imagem quebrada, sem nada que apareça numa revisão de código.
 *
 * Foi assim que o preview do editor de cardápio ficou com a foto morta. O
 * sintoma ainda enganava: logo depois de subir a foto tudo parecia certo,
 * porque ali a URL era um `blob:` local, que a CSP permite. Só quebrava ao
 * voltar e avançar no navegador, quando o componente remontava sem o blob e
 * caía na URL do Storage. Chegou como "a imagem quebra quando eu volto".
 *
 * A REGRA
 *
 * `next/image` serve por `/_next/image`, que é mesma origem, e por isso é
 * sempre seguro. `<img>` cru só é aceitável quando o arquivo prova que a URL é
 * `blob:` ou `data:` — as duas outras coisas que a CSP permite.
 *
 * Este script é sintático e admite ser burlado por quem quiser. Ele não existe
 * para deter ninguém: existe para que a próxima pessoa que escrever `<img>`
 * leia o motivo antes de descobrir sozinha, três horas depois.
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const ARQUIVOS = globSync('src/**/*.{tsx,jsx}');

/** O que a CSP aceita além de 'self'. */
const PROVAS = ['blob:', 'data:'];

/**
 * Quantas linhas acima do `<img>` a prova pode estar.
 *
 * A primeira versão deste script procurava a prova no ARQUIVO INTEIRO, e isso o
 * tornava quase inútil: qualquer menção solta a "data:" num comentário
 * absolvia um `<img>` cinquenta linhas adiante. A prova precisa estar no
 * ternário que escolhe entre `<img>` e `next/image`, que fica logo acima.
 */
const JANELA = 25;

interface Achado {
  arquivo: string;
  linha: number;
  trecho: string;
}

const achados: Achado[] = [];
let comImgCru = 0;

for (const arquivo of ARQUIVOS) {
  const conteudo = readFileSync(arquivo, 'utf8');
  const linhas = conteudo.split('\n');

  linhas.forEach((linha, i) => {
    // A linha precisa COMEÇAR com a tag, senão o script conta as próprias
    // menções a `<img>` dentro de comentários — foi o que a primeira versão
    // fez, relatando dois elementos onde havia um.
    //
    // E o `$` no final NÃO é decoração: o prettier quebra a linha logo depois
    // da tag, então o caso normal é `<img` sozinho na linha, sem caractere
    // nenhum em seguida. Sem essa alternativa o script relatava ZERO onde havia
    // um — um guarda que conta zero é pior que guarda nenhum, porque dá
    // conforto.
    if (!/^\s*<img(\s|>|$)/.test(linha)) return;
    comImgCru += 1;

    const janela = linhas.slice(Math.max(0, i - JANELA), i).join('\n');
    if (PROVAS.some((p) => janela.includes(p))) return;

    achados.push({ arquivo, linha: i + 1, trecho: linha.trim().slice(0, 80) });
  });
}

console.log(`  ${ARQUIVOS.length} componentes varridos, ${comImgCru} com <img> cru.`);

if (achados.length > 0) {
  console.error('\n✗ <img> cru sem prova de que a URL é blob: ou data:\n');
  for (const a of achados) {
    console.error(`  ${a.arquivo}:${a.linha}`);
    console.error(`    ${a.trecho}`);
  }
  console.error(
    '\n  A CSP é `img-src \'self\' blob: data:`. URL do Storage não é \'self\' e será',
  );
  console.error('  bloqueada em silêncio. Use next/image, que serve por /_next/image.');
  process.exit(1);
}

console.log("✓ nenhuma imagem fora do que a CSP permite ('self', blob:, data:).");
