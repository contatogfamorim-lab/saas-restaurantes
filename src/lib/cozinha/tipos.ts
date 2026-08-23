/**
 * Tipos compartilhados entre a tela da cozinha e suas Server Actions.
 *
 * Vive fora do arquivo `'use server'` porque módulo de Server Action só pode
 * exportar funções assíncronas — uma constante ou um valor ali derruba o módulo
 * inteiro na avaliação, junto com todas as ações que ele exporta.
 */
export interface ResultadoKds {
  ok: boolean;
  mensagem?: string;
}
