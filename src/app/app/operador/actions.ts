'use server';

import { redirect } from 'next/navigation';

import { entrarComoOperador, type ResultadoOperador } from '@/lib/auth/operator';

/**
 * Entrada do operador.
 *
 * O redirect fica FORA do try do `entrarComoOperador`: `redirect()` funciona
 * lançando uma exceção especial, e engoli-la num catch faria o login
 * "funcionar" sem sair da tela.
 */
export async function entrarOperador(
  codigo: string,
  senha: string,
): Promise<ResultadoOperador> {
  const r = await entrarComoOperador(codigo, senha);
  return r;
}

export async function irParaMinhaTela(): Promise<never> {
  redirect('/app');
}
