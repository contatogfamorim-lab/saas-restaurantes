/**
 * Digitaliza o cardápio: foto de produto → modelo 3D publicado.
 *
 *   pnpm modelos:gerar                # todos que ainda não têm modelo
 *   pnpm modelos:gerar --refazer      # inclusive os que já têm
 *   pnpm modelos:gerar --limite=3     # só os três primeiros
 *   pnpm modelos:gerar --produto=smash  # só o que casar com o texto no nome
 *   pnpm modelos:gerar --qualidade=baixa # alta (padrão) | media | baixa
 *   pnpm modelos:gerar --simulado     # sem rede, para testar o encanamento
 *   pnpm modelos:gerar --reprocessar  # refaz o acabamento do bruto guardado
 *
 * O BRUTO FICA GUARDADO, E ISSO NÃO É DETALHE
 *
 * A malha que volta do serviço é salva em `.modelos-brutos/` antes de qualquer
 * tratamento. Custou caro descobrir por quê: um erro meu no acabamento — a
 * conversão de textura para WebP, que o Three não carrega — só apareceu com o
 * prato branco na tela, e corrigir exigiu gerar tudo de novo, mais 120 segundos
 * de uma cota que dá para meia dúzia de pratos por dia.
 *
 * Com o bruto em disco, ajustar simplificação, textura ou escala é `--reprocessar`
 * e custa zero de GPU. A parte cara é a geração; ela deve acontecer uma vez.
 *
 * O CAMINHO INTEIRO, EM ORDEM
 *
 *   1. baixa a foto que já está no cardápio
 *   2. manda ao gerador, que remove o fundo e reconstrói a malha
 *   3. recebe DOIS níveis da mesma geração: leve para o card, pesado para o AR
 *   4. encaixa a escala em metros e põe a origem na base
 *   5. comprime com Draco
 *   6. sobe ao bucket e liga em `product_models`
 *
 * DE UM EM UM, E RETOMÁVEL
 *
 * Não é lentidão por descuido. A geração roda em GPU emprestada com orçamento
 * de segundos por conta, e o cardápio inteiro não cabe num dia de cota
 * gratuita. Então: um prato por vez, cada um gravado assim que fica pronto, e
 * parada limpa quando a cota acaba — rodar de novo amanhã continua de onde
 * parou, sem refazer nada.
 *
 * A ESCALA AINDA É ESTIMADA
 *
 * O gerador devolve um objeto normalizado; quem sabe que o prato tem 26 cm é o
 * dono. Enquanto a captura com objeto de referência não existe, a largura vem
 * deduzida do tipo do prato e é gravada com `largura_estimada = true`. O modelo
 * fica certo no card de qualquer jeito — o enquadramento é derivado do objeto —
 * e o AR sabe que deve dizer "aproximado".
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';

/**
 * O tipo do cliente sai da MESMA chamada que o cria.
 *
 * `ReturnType<typeof createClient>` sem os argumentos resolve os genéricos com
 * os padrões da assinatura, que não são os que a chamada real produz — e o erro
 * que sai disso (`"public" is not assignable to type never`) não aponta para
 * nada que ajude. Amarrar o tipo à fábrica concreta acaba com a divergência.
 */
function conectar() {
  return createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false } });
}

type Cliente = ReturnType<typeof conectar>;

import { NIVEIS, acabar, conferirEscala } from '../src/lib/palco/geracao/acabamento.ts';
import {
  CotaEsgotada,
  ProvedorTrellis,
  QUALIDADES,
  type NomeDaQualidade,
} from '../src/lib/palco/geracao/trellis.ts';
import { tipoDoPrato } from '../src/lib/palco/geracao/tipo-do-prato.ts';
import type { Provedor } from '../src/lib/palco/geracao/provedor.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_FOTOS = 'product-photos';
const BUCKET_MODELOS = 'product-models';

const args = new Set(process.argv.slice(2));
const arg = (nome: string) =>
  process.argv.slice(2).find((a) => a.startsWith(`--${nome}=`))?.split('=')[1];

const REFAZER = args.has('--refazer');
const REPROCESSAR = args.has('--reprocessar');

/** Onde a malha crua do serviço fica guardada, para reprocessar sem gastar GPU. */
const BRUTOS = join(import.meta.dirname, '..', '.modelos-brutos');
const SIMULADO = args.has('--simulado');
const LIMITE = Number(arg('limite') ?? Infinity);
const PRODUTO = arg('produto')?.toLowerCase();
const QUALIDADE = (arg('qualidade') ?? 'alta') as NomeDaQualidade;

/**
 * Provedor de mentira: devolve um dos modelos procedurais já gerados.
 *
 * Serve para exercitar tudo o que vem DEPOIS da geração — escala, origem,
 * compressão, upload, banco — sem gastar cota nem depender da rede. É onde a
 * maioria dos defeitos deste script apareceu.
 */
function provedorSimulado(): Provedor {
  return {
    nome: 'simulado',
    async gerar(pedido) {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tipoDoPrato } = await import('../src/lib/palco/geracao/tipo-do-prato.ts');

      const base = join(import.meta.dirname, '..', 'public', 'modelos-de-teste');
      const modelo = tipoDoPrato(pedido.nome).modelo;

      return {
        glb: new Uint8Array(await readFile(join(base, `${modelo}-hero.glb`))),
        segundos: 0,
      };
    },
  };
}

async function main() {
  if (!SERVICE_KEY) {
    console.error('✗ SUPABASE_SERVICE_ROLE_KEY ausente. Rode com --env-file=.env.local');
    process.exit(1);
  }

  // Sem token o script AVISA e tenta assim mesmo, em vez de barrar.
  //
  // A cota anônima do ZeroGPU é minúscula e some rápido, mas existe e renova.
  // Barrar de antemão transformaria "talvez passe" em "não dá", que é uma
  // afirmação mais forte do que eu consigo sustentar — e a mensagem de erro do
  // próprio serviço diz exatamente quantos segundos restam, o que é mais útil
  // que um palpite meu.
  if (!SIMULADO && !process.env.HF_TOKEN) {
    console.warn(
      '⚠ HF_TOKEN ausente — usando a cota anônima do ZeroGPU, que é mínima.\n' +
        '  Token gratuito em https://huggingface.co/settings/tokens\n',
    );
  }

  const supabase = conectar();
  const provedor: Provedor = SIMULADO
    ? provedorSimulado()
    : new ProvedorTrellis(process.env.HF_TOKEN, QUALIDADES[QUALIDADE] ?? QUALIDADES.alta);

  const { data: produtos, error } = await supabase
    .from('products')
    .select('id, name, restaurant_id, image_url, sort_order, categories!inner(name)')
    .not('image_url', 'is', null)
    .order('sort_order');

  if (error || !produtos) {
    console.error('✗ não consegui ler os produtos:', error?.message);
    process.exit(1);
  }

  const { data: existentes } = await supabase
    .from('product_models')
    .select('product_id, status');
  const jaPronto = new Set(
    (existentes ?? []).filter((m) => m.status === 'pronto').map((m) => m.product_id),
  );

  const fila = produtos
    .filter((p) => REFAZER || !jaPronto.has(p.id))
    .filter((p) => !PRODUTO || p.name.toLowerCase().includes(PRODUTO))
    .slice(0, LIMITE);

  if (fila.length === 0) {
    console.log('Nada a fazer: todos os produtos com foto já têm modelo pronto.');
    console.log('Para refazer assim mesmo: --refazer');
    return;
  }

  console.log(
    `${fila.length} prato(s) na fila, provedor "${provedor.nome}"` +
      (SIMULADO ? '' : `, qualidade "${QUALIDADE}"`) + '.' +
      (SIMULADO ? '' : ' Um por vez — a cota de GPU é o gargalo.\n'),
  );

  let prontos = 0;
  let falhas = 0;
  let segundos = 0;
  let interrompido = false;

  for (const produto of fila) {
    const categoria = (produto.categories as unknown as { name: string }).name;
    const tipo = tipoDoPrato(produto.name, categoria);

    // Marca ANTES de começar: se o processo morrer no meio, o banco mostra o
    // que ficou preso em 'processando' em vez de fingir que nunca aconteceu.
    await supabase.from('product_models').upsert(
      {
        product_id: produto.id,
        restaurant_id: produto.restaurant_id,
        status: 'processando',
        origem: 'foto',
        provedor: provedor.nome,
        erro: null,
      },
      { onConflict: 'product_id' },
    );

    try {
      const bruto = join(BRUTOS, `${produto.id}.glb`);
      let gerado;

      if (REPROCESSAR) {
        // Reaproveita a malha crua da geração anterior. É o que permite ajustar
        // o acabamento à vontade sem tocar na cota.
        gerado = { glb: new Uint8Array(await readFile(bruto)), segundos: 0 };
      } else {
        const foto = await baixarFoto(supabase, produto.image_url!);

        gerado = await provedor.gerar({
          fotos: [foto.bytes],
          tipos: [foto.tipo],
          nome: produto.name,
        });

        await mkdir(BRUTOS, { recursive: true });
        await writeFile(bruto, gerado.glb);
      }

      // Os dois níveis saem do MESMO arquivo denso: a geração é a parte cara,
      // e derivar aqui é o que evita pagar duas.
      const card = await acabar(gerado.glb, tipo.larguraCm, NIVEIS.card);
      const hero = await acabar(gerado.glb, tipo.larguraCm, NIVEIS.hero);
      conferirEscala(hero, produto.name);

      const base = `${produto.restaurant_id}/${produto.id}`;
      const caminhos = { card: `${base}-card.glb`, hero: `${base}-hero.glb` };

      await subir(supabase, caminhos.card, card.glb);
      await subir(supabase, caminhos.hero, hero.glb);

      const { error: dbErro } = await supabase.from('product_models').upsert(
        {
          product_id: produto.id,
          restaurant_id: produto.restaurant_id,
          status: 'pronto',
          origem: 'foto',
          provedor: provedor.nome,
          segundos: Math.round(gerado.segundos * 10) / 10,
          card_path: caminhos.card,
          hero_path: caminhos.hero,
          card_bytes: card.glb.byteLength,
          hero_bytes: hero.glb.byteLength,
          largura_cm: hero.larguraCm,
          largura_estimada: true,
          erro: null,
          pronto_em: new Date().toISOString(),
        },
        { onConflict: 'product_id' },
      );
      if (dbErro) throw new Error(dbErro.message);

      prontos++;
      segundos += gerado.segundos;
      console.log(
        `  ✓ ${produto.name.padEnd(30)} ` +
          `card ${(card.glb.byteLength / 1024).toFixed(0).padStart(4)} KB/${card.triangulos}tri · ` +
          `hero ${(hero.glb.byteLength / 1024).toFixed(0).padStart(4)} KB/${hero.triangulos}tri · ` +
          `${hero.larguraCm}×${hero.alturaCm} cm · ${gerado.segundos.toFixed(0)}s` +
          (hero.mesaRemovida > 0 ? ` · mesa −${hero.mesaRemovida}tri` : ''),
      );
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);

      await supabase
        .from('product_models')
        .update({ status: 'falhou', erro: mensagem.slice(0, 500) })
        .eq('product_id', produto.id);

      // Cota não é defeito deste prato: é o fim do orçamento. Insistir nos 29
      // seguintes só produz 29 mensagens iguais.
      if (erro instanceof CotaEsgotada) {
        console.error(`\n⏸  ${mensagem}`);
        console.error(
          `   ${prontos} prontos, ${fila.length - prontos - falhas} na fila. ` +
            'Rodar de novo continua daqui.',
        );
        interrompido = true;
        break;
      }

      falhas++;
      console.error(`  ✗ ${produto.name.padEnd(30)} ${mensagem}`);
    }
  }

  // Sem o `interrompido`, uma parada por cota terminava com "0 prontos, 0
  // falharam" logo abaixo da mensagem dizendo que sobrou 1 na fila — o resumo
  // contradizendo a linha anterior.
  console.log(
    `\n${prontos} prontos, ${falhas} falharam` +
      (interrompido ? ', e o resto ficou para a próxima rodada' : '') +
      '.' +
      (segundos > 0 ? ` ${segundos.toFixed(0)}s de GPU no total.` : ''),
  );
}

async function baixarFoto(
  supabase: Cliente,
  caminho: string,
): Promise<{ bytes: Uint8Array; tipo: string }> {
  // `image_url` aceita caminho no bucket OU URL absoluta (0015).
  if (/^https?:\/\//i.test(caminho)) {
    const r = await fetch(caminho);
    if (!r.ok) throw new Error(`foto não baixou: ${r.status}`);
    return {
      bytes: new Uint8Array(await r.arrayBuffer()),
      tipo: r.headers.get('content-type') ?? 'image/jpeg',
    };
  }

  const { data, error } = await supabase.storage.from(BUCKET_FOTOS).download(caminho);
  if (error || !data) throw new Error(`foto não baixou: ${error?.message}`);

  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    tipo: data.type || 'image/webp',
  };
}

async function subir(
  supabase: Cliente,
  caminho: string,
  bytes: Uint8Array,
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET_MODELOS)
    .upload(caminho, bytes, { contentType: 'model/gltf-binary', upsert: true });

  if (error) throw new Error(`upload falhou: ${error.message}`);
}

await main();
