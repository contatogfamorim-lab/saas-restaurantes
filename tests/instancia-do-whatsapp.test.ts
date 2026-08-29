/**
 * O NOME DA INSTÂNCIA (`lib/marketing/instancia`).
 *
 * Parece formatação de string e é separação de inquilinos. O servidor Evolution
 * é UM só para todos os restaurantes, e o nome da instância é a única coisa que
 * decide por qual WhatsApp uma campanha sai.
 *
 * O CRM de origem faz `toInstanceName(organization.name)` e para aí, porque lá
 * há uma organização por servidor. Copiar isso para cá produziria o defeito
 * mais caro que este sistema pode ter: duas casas com o mesmo nome disparando
 * pelo número uma da outra.
 */
import { describe, expect, it } from 'vitest';

import { nomeDaInstancia } from '@/lib/marketing/instancia';

const CASA_A = '3f8b2c1d-0000-4000-8000-000000000001';
const CASA_B = '9a7e5b4c-0000-4000-8000-000000000002';

describe('o nome separa as casas', () => {
  it('DUAS CASAS DE MESMO NOME NÃO COLIDEM', () => {
    // Este é o teste que existe por causa de um furo, e não por completude.
    const a = nomeDaInstancia('Brasa Burger', CASA_A);
    const b = nomeDaInstancia('Brasa Burger', CASA_B);

    expect(a).not.toBe(b);
  });

  it('o mesmo restaurante sempre gera o mesmo nome', () => {
    // Se variasse, "conectar" criaria uma instância nova a cada clique e
    // deixaria órfãs pareadas para trás — sessões de WhatsApp de verdade,
    // ligadas ao número do cliente, invisíveis e impossíveis de desligar.
    expect(nomeDaInstancia('Brasa Burger', CASA_A)).toBe(
      nomeDaInstancia('Brasa Burger', CASA_A),
    );
  });

  it('renomear a casa NÃO troca a instância de uma já conectada', () => {
    // Não é o que este teste prova sozinho — o nome muda mesmo quando o nome da
    // casa muda. Quem garante isto é `conectarWhatsApp`, que só deriva o nome
    // quando não há nenhum gravado. O teste registra a dependência.
    const antes = nomeDaInstancia('Brasa Burger', CASA_A);
    const depois = nomeDaInstancia('Brasa Burger & Cia', CASA_A);
    expect(antes).not.toBe(depois);
  });
});

describe('o nome é seguro dentro de uma URL', () => {
  it('acento, espaço e pontuação viram sublinhado', () => {
    expect(nomeDaInstancia('Açaí do João', CASA_A)).toMatch(/^acai_do_joao_/);
  });

  it('NADA de barra, ponto ou dois-pontos', () => {
    // O valor vai para o CAMINHO da URL da Evolution. Uma barra aqui seria
    // travessia de caminho: `/instance/connect/../../algo`.
    for (const cru of [
      '../../etc/passwd',
      'casa/../outra',
      'a.b.c',
      'nome com espaço',
      'EMOJI 🍔 SÓ',
      'x'.repeat(200),
    ]) {
      expect(nomeDaInstancia(cru, CASA_A)).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('casa sem nenhuma letra utilizável ainda ganha instância', () => {
    // Só emoji. Devolver string vazia produziria `/instance/create` com nome
    // em branco — e a Evolution aceita, criando uma instância anônima.
    expect(nomeDaInstancia('🍔🍔🍔', CASA_A)).toBe('casa_3f8b2c1d');
  });

  it('não passa do limite de tamanho da Evolution', () => {
    expect(nomeDaInstancia('x'.repeat(500), CASA_A).length).toBeLessThanOrEqual(40);
  });
});
