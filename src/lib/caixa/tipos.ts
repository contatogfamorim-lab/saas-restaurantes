/**
 * Tipos e constantes compartilhados entre a tela do caixa e suas Server Actions.
 *
 * Vive fora do arquivo `'use server'` porque módulo de Server Action só pode
 * exportar funções assíncronas — uma constante ali derruba o módulo inteiro na
 * avaliação, junto com todas as ações que ele exporta.
 */

export const METODOS_PAGAMENTO = [
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'credito', rotulo: 'Crédito' },
  { valor: 'debito', rotulo: 'Débito' },
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
  { valor: 'voucher', rotulo: 'Voucher' },
] as const;

export type MetodoPagamento = (typeof METODOS_PAGAMENTO)[number]['valor'];

export interface ResultadoCaixa {
  ok: boolean;
  mensagem?: string;
  /** Preenchido quando a ação precisa de confirmação explícita do humano. */
  confirmar?: 'itens_na_cozinha' | 'saldo_em_aberto';
  /** Troco a devolver, em centavos. Só em pagamento em dinheiro. */
  trocoCents?: number;
}
