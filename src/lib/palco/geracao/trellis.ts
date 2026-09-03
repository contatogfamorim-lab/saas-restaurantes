import { Client } from '@gradio/client';

import type { ModeloGerado, PedidoDeGeracao, Provedor } from './provedor';

/**
 * TRELLIS.2, da Microsoft, rodando no Space público do Hugging Face.
 *
 * POR QUE ESTE E NÃO OUTRO
 *
 * Licença MIT, sem cláusula de usuários ativos, sem território excluído e sem
 * gatilho de receita — as alternativas fortes têm pelo menos uma das três. O
 * Hunyuan3D da Tencent exclui União Europeia, Reino Unido e Coreia do Sul; os
 * modelos da Stability trazem licença de comunidade com teto de faturamento.
 * Para software que vai ser vendido a restaurante, licença com asterisco é
 * dívida futura.
 *
 * Além disso ele aceita VÁRIAS imagens do mesmo objeto, que é para onde este
 * recurso vai: hoje uma foto, amanhã seis ângulos tirados pelo dono.
 *
 * COMO O SPACE FUNCIONA, E POR QUE A SESSÃO IMPORTA
 *
 * A API tem estado. `image_to_3d` gera e GUARDA o resultado do lado de lá;
 * `extract_glb` extrai da geração anterior daquela sessão. Ou seja: as chamadas
 * não são independentes, e duas gerações em paralelo na mesma sessão embaralham
 * o resultado. Uma conexão por prato, sempre em série.
 *
 * O TETO É A COTA, NÃO O CÓDIGO
 *
 * O Space roda em ZeroGPU: GPU emprestada, com orçamento de segundos por conta.
 * Anônimo é praticamente zero — testei e a geração pede 60s contra 0s
 * disponíveis. Com token de conta gratuita existe cota; para gerar um cardápio
 * inteiro de uma vez, provavelmente só com PRO. O pipeline foi feito com isso
 * em mente: ele processa de um em um e para com mensagem clara quando a cota
 * acaba, sem perder o que já fez.
 */

/**
 * Os pisos dos controles do Space, lidos de `/config`.
 *
 * Ficam nomeados porque são a razão de o pipeline ter a forma que tem: se a
 * decimação pudesse descer a 4 mil, o nível do card viria pronto do serviço e
 * este projeto não precisaria de `meshoptimizer` nem de `sharp`.
 */
const LIMITES = { decimacaoMin: 100_000, texturaMin: 1024 } as const;

/** Passos de amostragem. Menos passos, menos GPU pedida, menos detalhe. */
interface Qualidade {
  resolucao: '512' | '1024';
  passos: number;
}

/**
 * Três ajustes, porque a cota é medida em SEGUNDOS por dia e não em gerações.
 *
 * O quanto o serviço reserva de GPU cresce com a resolução e com os passos, e
 * ele recusa o pedido inteiro se o saldo não cobrir a reserva — não adianta ter
 * 155s e pedir uma geração de 180s, ela não roda pela metade. Ter os três
 * ajustes nomeados é o que permite encaixar o que resta do dia em vez de perder
 * a rodada.
 *
 * `alta` é o padrão do próprio Space.
 */
export const QUALIDADES = {
  alta: { resolucao: '1024', passos: 12 },
  media: { resolucao: '1024', passos: 8 },
  baixa: { resolucao: '512', passos: 8 },
} as const satisfies Record<string, Qualidade>;

export type NomeDaQualidade = keyof typeof QUALIDADES;

const PADRAO: Qualidade = QUALIDADES.alta;

export class ProvedorTrellis implements Provedor {
  readonly nome = 'trellis.2';

  // Campos declarados e atribuídos à mão, em vez de propriedades de construtor.
  // O Node executa TypeScript em modo "strip-only": ele apaga os tipos e não
  // transforma nada — e `constructor(private x)` é transformação, não anotação.
  // Como este arquivo é importado pelos scripts `.mts`, a forma curta quebraria
  // o comando inteiro com um erro que não menciona este arquivo.
  private readonly token: string | undefined;
  private readonly qualidade: Qualidade;

  constructor(token: string | undefined, qualidade: Qualidade = PADRAO) {
    this.token = token;
    this.qualidade = qualidade;
  }

  async gerar(pedido: PedidoDeGeracao): Promise<ModeloGerado> {
    const inicio = Date.now();

    // `token`, e não `hf_token`: o segundo está depreciado no @gradio/client e
    // avisa em toda execução.
    const app = await Client.connect('microsoft/TRELLIS.2', {
      token: this.token as `hf_${string}` | undefined,
    });

    try {
      await app.predict('/start_session', []);

      // O Space remove o fundo antes de gerar. Vale MUITO num cardápio: foto de
      // prato vem com toalha, talher e mão de garçom em volta, e sem o recorte
      // o modelo tenta reconstruir a mesa junto.
      const pre = await app.predict('/preprocess_image', {
        input: new Blob([pedido.fotos[0] as BlobPart], { type: pedido.tipos[0] }),
      });

      const imagem = (pre.data as unknown[])[0];
      const q = this.qualidade;

      await app.predict('/image_to_3d', {
        image: imagem,
        seed: 42, // fixo: o mesmo prato tem que gerar o mesmo modelo duas vezes
        resolution: q.resolucao,
        ss_guidance_strength: 7.5,
        ss_guidance_rescale: 0,
        ss_sampling_steps: q.passos,
        ss_rescale_t: 3,
        shape_slat_guidance_strength: 3,
        shape_slat_guidance_rescale: 0,
        shape_slat_sampling_steps: q.passos,
        shape_slat_rescale_t: 3,
        tex_slat_guidance_strength: 3,
        tex_slat_guidance_rescale: 0,
        tex_slat_sampling_steps: q.passos,
        tex_slat_rescale_t: 3,
      });

      // UMA extração, no mínimo que o serviço aceita.
      //
      // A intenção era pedir os dois níveis aqui — `extract_glb` não regenera
      // nada, só decima o resultado que já está na sessão, e sairia de graça.
      // Mas os controles têm piso: decimação mínima de 100 mil triângulos,
      // textura mínima de 1024. Pedir 20 mil devolve
      // "Value 20000 is less than minimum value 100000" e perde a geração
      // inteira, que é a parte cara. Descoberto do jeito difícil.
      //
      // Então baixa-se o denso uma vez e `acabamento.ts` deriva os dois níveis.
      const glb = await this.extrair(app, LIMITES.decimacaoMin, LIMITES.texturaMin);

      return { glb, segundos: (Date.now() - inicio) / 1000 };
    } catch (erro) {
      throw new Error(traduzir(erro, pedido.nome));
    }
  }

  private async extrair(
    app: Awaited<ReturnType<typeof Client.connect>>,
    triangulos: number,
    textura: number,
  ): Promise<Uint8Array> {
    const saida = await app.predict('/extract_glb', {
      decimation_target: triangulos,
      texture_size: textura,
    });

    const arquivo = (saida.data as Array<{ url?: string }>)[0];
    if (!arquivo?.url) throw new Error('o Space não devolveu arquivo');

    const resposta = await fetch(arquivo.url);
    if (!resposta.ok) throw new Error(`download do GLB falhou: ${resposta.status}`);

    return new Uint8Array(await resposta.arrayBuffer());
  }
}

/**
 * Erro do Gradio vira mensagem que serve para decidir o que fazer.
 *
 * O caso que importa é a cota: ele não é um defeito, é o fim do orçamento do
 * dia. Quem chama precisa distinguir "este prato falhou, siga para o próximo"
 * de "pare tudo, não adianta insistir".
 */
export class CotaEsgotada extends Error {}

function traduzir(erro: unknown, nome: string): string {
  const texto = erro instanceof Error ? erro.message : String(erro);

  if (/quota/i.test(texto)) {
    const sobra = texto.match(/(\d+)s\s+left/)?.[1];
    throw new CotaEsgotada(
      `Cota de GPU do Hugging Face esgotada${sobra ? ` (restam ${sobra}s)` : ''}. ` +
        'Com HF_TOKEN de conta gratuita a cota é pequena; para gerar o cardápio ' +
        'inteiro de uma vez costuma ser preciso o plano PRO.',
    );
  }

  if (/GPU task aborted|runtime error/i.test(texto)) {
    return `${nome}: o Space caiu no meio da geração. Tente de novo em alguns minutos.`;
  }

  return `${nome}: ${texto}`;
}
