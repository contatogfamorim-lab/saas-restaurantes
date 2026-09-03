/**
 * Popula o Storage com modelos 3D de prato — APENAS local e staging.
 *
 *   pnpm db:modelos
 *
 * Sobe os pratos procedurais gerados por `gerar-modelos-de-teste.mts` e liga
 * cada produto a um deles, para o cardápio ter o que mostrar antes de existir
 * digitalização de verdade.
 *
 * A ESCOLHA É PELO NOME DO PRATO, NÃO PELA CATEGORIA
 *
 * A primeira versão mapeava por categoria, e o resultado foi um cardápio em que
 * as cinco bebidas e as quatro sobremesas apareciam todas como a mesma tigela —
 * o que não mostra nada sobre o produto final, só que o renderizador funciona.
 *
 * As regras moram em `tipo-do-prato.ts`, compartilhadas com o gerador de
 * verdade. Enquanto eram duas listas, elas divergiam — e divergir ali significa
 * o mesmo prato com um modelo no card e outro tamanho no AR.
 *
 * A LARGURA É DADO, NÃO ENFEITE
 *
 * `largura_cm` é o que sustenta a promessa de tamanho real no AR, e sai daqui
 * medida do próprio arquivo — não chutada. Os pratos procedurais são autorados
 * em metros no tamanho real (prato raso de 26 cm, pizza de 30, tigela de 16), e
 * o número é lido da bounding box do GLB.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

import { tipoDoPrato } from '../src/lib/palco/geracao/tipo-do-prato.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'product-models';

const ORIGEM = join(import.meta.dirname, '..', 'public', 'modelos-de-teste');

/** Maior dimensão horizontal do modelo, em centímetros, lida do arquivo. */
async function medirLarguraCm(glb: Uint8Array): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

  const doc = await io.readBinary(glb);
  const caixa = getBounds(doc.getRoot().listScenes()[0]);

  // glTF é definido em METROS. Um modelo exportado em centímetros passaria por
  // aqui como um prato de 26 metros — que é exatamente o erro silencioso que
  // este número existe para pegar.
  const metros = Math.max(caixa.max[0] - caixa.min[0], caixa.max[2] - caixa.min[2]);
  return Math.round(metros * 100 * 10) / 10;
}

async function main() {
  if (!SERVICE_KEY) {
    console.error('✗ SUPABASE_SERVICE_ROLE_KEY ausente. Rode com --env-file=.env.local');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data: produtos, error } = await supabase
    .from('products')
    .select('id, name, restaurant_id, sort_order, categories!inner(name)')
    .order('sort_order');

  if (error || !produtos) {
    console.error('✗ não consegui ler os produtos:', error?.message);
    process.exit(1);
  }

  const arquivos = new Map<string, Uint8Array>();
  const larguras = new Map<string, number>();

  async function ler(receita: string, nivel: 'card' | 'hero'): Promise<Uint8Array> {
    const chave = `${receita}-${nivel}`;
    if (!arquivos.has(chave)) {
      const dados = new Uint8Array(await readFile(join(ORIGEM, `${chave}.glb`)));
      arquivos.set(chave, dados);
      if (nivel === 'hero') larguras.set(receita, await medirLarguraCm(dados));
    }
    return arquivos.get(chave)!;
  }

  const usados = new Map<string, number>();
  let bytes = 0;

  for (const produto of produtos) {
    const categoria = (produto.categories as unknown as { name: string }).name;
    const receita = tipoDoPrato(produto.name, categoria).modelo;
    usados.set(receita, (usados.get(receita) ?? 0) + 1);

    const card = await ler(receita, 'card');
    const hero = await ler(receita, 'hero');

    const base = `${produto.restaurant_id}/${produto.id}`;
    const caminhos = { card: `${base}-card.glb`, hero: `${base}-hero.glb` };

    for (const [nivel, caminho] of Object.entries(caminhos)) {
      const dados = nivel === 'card' ? card : hero;
      const { error: upErro } = await supabase.storage
        .from(BUCKET)
        .upload(caminho, dados, { contentType: 'model/gltf-binary', upsert: true });

      if (upErro) {
        console.error(`✗ ${produto.name} (${nivel}): ${upErro.message}`);
        process.exit(1);
      }
      bytes += dados.byteLength;
    }

    const { error: dbErro } = await supabase.from('product_models').upsert(
      {
        product_id: produto.id,
        restaurant_id: produto.restaurant_id,
        status: 'pronto',
        // 'teste' é o que permite apagar o seed inteiro sem encostar num
        // modelo gerado a partir da foto de um cliente de verdade.
        origem: 'teste',
        provedor: 'procedural',
        largura_estimada: true,
        card_path: caminhos.card,
        hero_path: caminhos.hero,
        card_bytes: card.byteLength,
        hero_bytes: hero.byteLength,
        largura_cm: larguras.get(receita) ?? null,
        pronto_em: new Date().toISOString(),
      },
      { onConflict: 'product_id' },
    );

    if (dbErro) {
      console.error(`✗ ${produto.name}: ${dbErro.message}`);
      process.exit(1);
    }

    const kb = ((card.byteLength + hero.byteLength) / 1024).toFixed(0);
    console.log(
      `  ✓ ${produto.name.padEnd(30)} ${receita.padEnd(17)} ${kb.padStart(4)} KB  ` +
        `${larguras.get(receita)} cm`,
    );
  }

  const comModelo = produtos.length;
  const repetidos = [...usados.entries()].filter(([, n]) => n > 1);

  console.log(
    `\n${comModelo} produtos, todos com modelo. ${usados.size} modelos distintos. ` +
      `${(bytes / 1024 / 1024).toFixed(1)} MB no bucket ` +
      `(${(bytes / 1024 / comModelo).toFixed(0)} KB por prato, card + hero).`,
  );

  // Repetição não é defeito — dois burgers clássicos DEVEM usar o mesmo modelo.
  // Mas é o número a olhar quando o cardápio parecer monótono demais.
  if (repetidos.length > 0) {
    console.log(
      `  reaproveitados: ${repetidos.map(([m, n]) => `${m}×${n}`).join(', ')}`,
    );
  }
}

await main();
