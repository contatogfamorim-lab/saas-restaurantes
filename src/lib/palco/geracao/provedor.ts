/**
 * A interface que separa "gerar um modelo" de "quem gera".
 *
 * POR QUE UM ADAPTADOR, E NÃO UMA CHAMADA DIRETA
 *
 * A escolha do gerador é a decisão mais volátil deste projeto inteiro. Hoje o
 * TRELLIS.2 da Microsoft é MIT e roda de graça num Space do Hugging Face; em
 * seis meses pode ser outro modelo, ou o mesmo modelo numa GPU nossa, ou uma
 * API paga quando o volume justificar. O que NÃO muda é o resto do caminho:
 * pegar a foto, pedir a malha, encaixar a escala, comprimir, publicar.
 *
 * Então o resto do caminho não conhece o gerador. Trocar de provedor é escrever
 * um arquivo novo aqui e mudar uma linha de configuração — não é reescrever o
 * pipeline.
 */

export interface PedidoDeGeracao {
  /** As fotos do prato. Uma só já funciona; mais ângulos melhoram o verso. */
  fotos: Uint8Array[];
  /** Tipo MIME das fotos, na mesma ordem. */
  tipos: string[];
  /** Só para log e mensagem de erro. */
  nome: string;
}

export interface ModeloGerado {
  /**
   * A malha densa, do jeito que o gerador entregou.
   *
   * UM arquivo só, e não dois. A ideia inicial era pedir os dois níveis ao
   * serviço — ele tem controle de decimação e sairia de graça. Não dá: o
   * TRELLIS.2 aceita no mínimo 100 mil triângulos e textura de 1024, muito
   * acima do que um card de 230 px precisa. Então baixa-se a versão densa uma
   * vez e os dois níveis são derivados aqui.
   */
  glb: Uint8Array;
  /** Quanto tempo o provedor levou, em segundos. Entra no log de custo. */
  segundos: number;
}

export interface Provedor {
  readonly nome: string;

  /**
   * Gera a malha. Deve LANÇAR com mensagem legível quando falhar — o pipeline
   * grava essa mensagem em `product_models.erro`, e ela vai aparecer para quem
   * cadastrou o prato.
   */
  gerar(pedido: PedidoDeGeracao): Promise<ModeloGerado>;
}
