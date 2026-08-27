/**
 * Normalização do número (`lib/marketing/numero`).
 *
 * Isto é aritmética de string, e é onde o erro manda mensagem para um
 * desconhecido. Um `55` a mais, um dígito a menos, e o destinatário é outra
 * pessoa — que recebe uma promoção de um restaurante onde nunca esteve, com o
 * primeiro nome de outro cliente no meio.
 *
 * A regra que atravessa todos os casos: NA DÚVIDA, RECUSA. Um destinatário
 * marcado como falho é um problema visível na tela do dono. Um número
 * "consertado" no chute é uma mensagem entregue no lugar errado, e ninguém
 * fica sabendo.
 */
import { describe, expect, it } from 'vitest';

import { numeroDoWhatsApp } from '@/lib/marketing/numero';

describe('o que passa', () => {
  it('celular com DDD, como o brasileiro digita', () => {
    expect(numeroDoWhatsApp('(11) 98765-4321')).toBe('5511987654321');
    expect(numeroDoWhatsApp('11987654321')).toBe('5511987654321');
    expect(numeroDoWhatsApp('11 9 8765 4321')).toBe('5511987654321');
  });

  it('fixo de 10 dígitos', () => {
    expect(numeroDoWhatsApp('1133334444')).toBe('551133334444');
  });

  it('número que já vem com o 55 não ganha outro', () => {
    // O erro clássico: 5511987654321 virando 555511987654321.
    expect(numeroDoWhatsApp('5511987654321')).toBe('5511987654321');
    expect(numeroDoWhatsApp('+55 11 98765-4321')).toBe('5511987654321');
    expect(numeroDoWhatsApp('551133334444')).toBe('551133334444');
  });
});

describe('o que é recusado', () => {
  it('curto demais para ser telefone', () => {
    expect(numeroDoWhatsApp('987654321')).toBeNull();
    expect(numeroDoWhatsApp('33334444')).toBeNull();
    expect(numeroDoWhatsApp('')).toBeNull();
    expect(numeroDoWhatsApp('abc')).toBeNull();
  });

  it('comprimento que não corresponde a nada conhecido', () => {
    // 14 dígitos não é telefone brasileiro com nem sem código de país.
    // Cortar ou completar aqui seria inventar o número de alguém.
    expect(numeroDoWhatsApp('55119876543210')).toBeNull();
    expect(numeroDoWhatsApp('123456789012')).toBeNull();
  });

  it('número internacional não brasileiro é recusado, não adivinhado', () => {
    // +1 (415) 555-0123 → 14155550123, onze dígitos. Cai na regra do celular
    // brasileiro e viraria 5514155550123, que é um número de São Paulo que
    // pertence a outra pessoa.
    //
    // Este teste documenta um LIMITE CONHECIDO, e não uma proteção: hoje o
    // sistema não distingue esse caso, porque não guarda o país do telefone.
    // Está aqui para que a limitação seja lida em vez de descoberta.
    expect(numeroDoWhatsApp('14155550123')).toBe('5514155550123');
  });
});
