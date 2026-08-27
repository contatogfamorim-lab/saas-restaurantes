/**
 * O número, no formato que a Evolution espera.
 *
 * Módulo separado de `enviar.ts` por um motivo prático: aquele arquivo começa
 * com `import 'server-only'`, e isso impede que ele seja carregado por um
 * teste unitário — a função mais fácil de errar do disparo ficaria sem teste
 * justamente por causa de uma guarda que existe para outra coisa.
 *
 * Aqui não há nada de servidor: é aritmética de string, e é onde o erro manda
 * mensagem para um desconhecido. Um `55` a mais, um dígito a menos, e quem
 * recebe é outra pessoa — com o primeiro nome de um cliente no meio.
 *
 * A regra que atravessa todos os casos: NA DÚVIDA, RECUSA. Destinatário
 * marcado como falho é um problema visível na tela do dono; número
 * "consertado" no chute é uma mensagem entregue no lugar errado, e ninguém
 * fica sabendo.
 */
export function numeroDoWhatsApp(bruto: string): string | null {
  const so = bruto.replace(/\D/g, '');
  if (so.length < 10) return null;

  // Já tem código de país: 55 + DDD (2) + número (8 ou 9) = 12 ou 13 dígitos.
  if (so.startsWith('55') && (so.length === 12 || so.length === 13)) return so;
  if (so.length === 10 || so.length === 11) return `55${so}`;

  // Qualquer outro comprimento é palpite.
  return null;
}
