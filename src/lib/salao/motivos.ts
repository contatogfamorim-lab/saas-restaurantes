/**
 * Motivos de liberação forçada de mesa (spec §5).
 *
 * Vive FORA do arquivo de Server Actions de propósito: um módulo `'use server'`
 * só pode exportar funções assíncronas, e uma constante ali derruba o módulo
 * inteiro na avaliação — junto com todas as ações que ele exporta.
 */
export const MOTIVOS_LIBERACAO = [
  { valor: 'cliente_foi_embora_sem_pagar', rotulo: 'Foi embora sem pagar' },
  { valor: 'mesa_aberta_por_engano', rotulo: 'Aberta por engano' },
  { valor: 'cortesia_da_casa', rotulo: 'Cortesia da casa' },
  { valor: 'outro', rotulo: 'Outro' },
] as const;

export type MotivoLiberacao = (typeof MOTIVOS_LIBERACAO)[number]['valor'];

/** O que a ação de liberar mesa devolve para a tela. */
export interface ResultadoAcao {
  ok: boolean;
  mensagem?: string;
  /** Preenchido quando a ação precisa de confirmação explícita do humano. */
  confirmar?: 'itens_na_cozinha' | 'saldo_em_aberto';
  detalhe?: string;
}
