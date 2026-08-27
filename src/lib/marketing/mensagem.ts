/**
 * A pré-visualização da mensagem.
 *
 * ESTA FUNÇÃO É UM ESPELHO, E ESPELHO RACHA.
 *
 * Quem monta a mensagem de verdade é `app.render_mensagem`, no banco — é ela
 * que congela o texto no destinatário, e é a única que importa. Isto aqui
 * existe só para a tela mostrar o resultado enquanto a pessoa digita.
 *
 * Duplicar lógica é ruim, e a alternativa era pior: sem pré-visualização, o
 * autor só descobre que o link de saída é acrescentado sozinho DEPOIS de
 * disparar — e até lá já escreveu o dele, e a mensagem sai com dois.
 *
 * A rachadura é contida por um teste: `tests/db/campanhas.test.ts` compara o
 * que esta função produz com o que o banco produz, para os mesmos valores. Se
 * alguém mexer em um lado só, o CI cai.
 */

/** O que o banco cola no fim de toda mensagem. */
export const RODAPE_DE_SAIDA = 'Para não receber mais: ';

/** Como o banco escreve dinheiro: R$ 1.234,56. */
export function reais(centavos: number): string {
  const inteiro = Math.trunc(Math.abs(centavos) / 100);
  const resto = String(Math.abs(centavos) % 100).padStart(2, '0');
  const comPontos = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${centavos < 0 ? '-' : ''}${comPontos},${resto}`;
}

export function renderMensagem(
  corpo: string,
  nome: string,
  saldoCents: number,
  urlBase: string,
  token: string,
): string {
  const primeiroNome = nome.trim().split(' ')[0] ?? '';
  const texto = corpo
    .replaceAll('{nome}', primeiroNome)
    .replaceAll('{saldo}', reais(saldoCents));

  return `${texto}\n\n${RODAPE_DE_SAIDA}${urlBase}/sair/${token}`;
}
