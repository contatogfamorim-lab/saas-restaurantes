/**
 * Popula o Storage com fotos de produto — APENAS local e staging.
 *
 *   pnpm db:photos
 *
 * As fotos vêm do CDN do Unsplash (Unsplash License: uso livre, comercial
 * inclusive, sem exigência de atribuição), já redimensionadas e comprimidas
 * pelo próprio CDN. São material de TESTE: no cliente real, a foto é a do
 * prato dele, subida no onboarding (Etapa 10).
 *
 * Por que passar pelo Storage em vez de apontar para o CDN externo:
 *  - exercita o caminho real (bucket, policy, URL pública, next/image);
 *  - a §13.2 mede egress do NOSSO plano, e foto servida de terceiro esconderia
 *    exatamente o custo que precisamos enxergar;
 *  - CSP e remotePatterns ficam restritos ao nosso domínio.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'product-photos';

/** Alvo da spec §13.2: até 50 KB por foto de produto. */
const ALVO_BYTES = 50 * 1024;

/**
 * Parâmetros do CDN do Unsplash. `w` cobre o maior uso real (a foto grande do
 * bottom sheet, 375 CSS px em tela 2x ≈ 750 px) com alguma folga.
 */
const LARGURA = 820;
const QUALIDADE_INICIAL = 52;

/**
 * Fotos por CATEGORIA, não por produto: o seed é fictício e o objetivo é
 * avaliar a direção visual, não casar cada foto com a receita. Cada produto
 * recebe uma foto do seu grupo, de forma determinística.
 */
const FOTOS: Record<string, string[]> = {
  Burgers: [
    'photo-1568901346375-23c9450c58cd',
    'photo-1571091718767-18b5b1457add',
    'photo-1553979459-d2229ba7433b',
    'photo-1586190848861-99aa4a171e90',
    'photo-1594212699903-ec8a3eca50f5',
    'photo-1603064752734-4c48eff53d05',
  ],
  'Pra dividir': [
    'photo-1573080496219-bb080dd4f877',
    'photo-1541592106381-b31e9677c0e5',
    'photo-1639024471283-03518883512d',
  ],
  Sobremesas: [
    'photo-1551024506-0bccd828d307',
    'photo-1563805042-7684c019e1cb',
    'photo-1488477181946-6428a0291777',
  ],
  Bebidas: [
    'photo-1544145945-f90425340c7e',
    'photo-1513558161293-cdaf765ed2fd',
    'photo-1600271886742-f049cd451bba',
  ],
  'Happy Hour': [
    'photo-1608270586620-248524c67de9',
    'photo-1572490122747-3968b75cc699',
    'photo-1541592106381-b31e9677c0e5',
  ],
};

async function baixarComprimido(
  id: string,
): Promise<{ bytes: Uint8Array; q: number; w: number }> {
  /**
   * Desce PRIMEIRO a qualidade, DEPOIS a largura.
   *
   * Nesta ordem porque em foto de comida a perda de qualidade some no ruído da
   * textura, enquanto perder largura estraga a foto grande do bottom sheet.
   * Abaixo de q=34 começa a aparecer banding no molho, então aí o que cede é a
   * largura.
   */
  const tentativas: Array<{ w: number; q: number }> = [
    { w: LARGURA, q: QUALIDADE_INICIAL },
    { w: LARGURA, q: 42 },
    { w: LARGURA, q: 34 },
    { w: 700, q: 38 },
    { w: 620, q: 36 },
  ];

  let ultima: { bytes: Uint8Array; q: number; w: number } | null = null;

  for (const { w, q } of tentativas) {
    const url = `https://images.unsplash.com/${id}?w=${w}&q=${q}&fm=webp&fit=crop&crop=entropy`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    ultima = { bytes, q, w };
    if (bytes.byteLength <= ALVO_BYTES) return ultima;
  }

  // Nem na menor configuração coube: entrega mesmo assim e deixa o "!" no log.
  // Foto muito detalhada existe, e travar o seed por causa disso seria pior.
  return ultima!;
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

  const cache = new Map<string, { bytes: Uint8Array; q: number; w: number }>();
  let total = 0;
  let maior = 0;

  for (const [i, produto] of produtos.entries()) {
    const categoria = (produto.categories as unknown as { name: string }).name;
    const pool = FOTOS[categoria] ?? FOTOS.Burgers;
    const fotoId = pool[i % pool.length];

    if (!cache.has(fotoId)) cache.set(fotoId, await baixarComprimido(fotoId));
    const { bytes, q, w } = cache.get(fotoId)!;

    const caminho = `${produto.restaurant_id}/${produto.id}.webp`;

    const { error: upErro } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, bytes, { contentType: 'image/webp', upsert: true });

    if (upErro) {
      console.error(`✗ ${produto.name}: ${upErro.message}`);
      process.exit(1);
    }

    const { error: dbErro } = await supabase
      .from('products')
      .update({ image_url: caminho })
      .eq('id', produto.id);

    if (dbErro) {
      console.error(`✗ ${produto.name}: ${dbErro.message}`);
      process.exit(1);
    }

    total += bytes.byteLength;
    maior = Math.max(maior, bytes.byteLength);
    const kb = (bytes.byteLength / 1024).toFixed(0);
    const marca = bytes.byteLength <= ALVO_BYTES ? '✓' : '!';
    console.log(`  ${marca} ${produto.name.padEnd(30)} ${kb.padStart(3)} KB  q=${q} w=${w}`);
  }

  const media = total / produtos.length / 1024;
  console.log(
    `\n✓ ${produtos.length} fotos no bucket. Média ${media.toFixed(0)} KB, ` +
      `maior ${(maior / 1024).toFixed(0)} KB (alvo: ${ALVO_BYTES / 1024} KB).`,
  );
  console.log(`  ${cache.size} imagens distintas — o resto é reuso.`);
}

main().catch((err) => {
  console.error('✗ seed-photos falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
