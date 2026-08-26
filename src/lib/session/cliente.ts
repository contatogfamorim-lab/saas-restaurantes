import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

import { serverEnv } from '@/lib/env.server';

/**
 * Conta do cliente (cashback).
 *
 * Espelha `cookie.ts` de propósito, e pela mesma razão: o id do cliente NUNCA
 * vem do corpo, da query string ou de header. Só deste cookie assinado.
 *
 * Aceitar `customer_id` de qualquer outro lugar seria entregar o saldo alheio a
 * quem trocasse um uuid — a mesma falha que a §10.4 fecha para `session_id`,
 * agora com dinheiro em jogo.
 *
 * O `rid` viaja junto e é CONFERIDO na leitura. Sem ele, um cookie emitido no
 * restaurante A abriria a conta no restaurante B; como a conta é por casa, o id
 * simplesmente não existiria lá — mas conferir é mais barato que descobrir.
 */

export const CLIENTE_COOKIE = 'cliente_conta';

/** 30 dias. É uma conta de fidelidade, não uma comanda: relogar toda visita
 *  anularia a comodidade que ela existe para dar. */
const TTL_SEGUNDOS = 30 * 24 * 60 * 60;

export interface ContaDoCliente {
  clienteId: string;
  restauranteId: string;
  nome: string;
}

function segredo(): Uint8Array {
  return new TextEncoder().encode(serverEnv().SESSION_COOKIE_SECRET);
}

const producao = process.env.NODE_ENV === 'production';

export async function abrirContaDoCliente(conta: ContaDoCliente): Promise<void> {
  const token = await new SignJWT({
    cid: conta.clienteId,
    rid: conta.restauranteId,
    nome: conta.nome,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SEGUNDOS}s`)
    .sign(segredo());

  const jar = await cookies();
  jar.set(CLIENTE_COOKIE, token, {
    httpOnly: true,
    secure: producao,
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_SEGUNDOS,
  });
}

/**
 * A conta atual, ou `null`.
 *
 * `restauranteId` é obrigatório no parâmetro: quem chama SEMPRE sabe em que
 * casa está — veio do `short_code` da mesa. Tornar a conferência opcional seria
 * deixá-la ser esquecida.
 */
export async function lerContaDoCliente(
  restauranteId: string,
): Promise<ContaDoCliente | null> {
  const jar = await cookies();
  const token = jar.get(CLIENTE_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, segredo(), { algorithms: ['HS256'] });
    const { cid, rid, nome } = payload as Record<string, unknown>;

    if (typeof cid !== 'string' || typeof rid !== 'string' || typeof nome !== 'string') {
      return null;
    }

    // Cookie de outra casa não vale aqui. Silencioso, e não erro: quem tem conta
    // no restaurante da esquina não fez nada de errado ao abrir o cardápio deste.
    if (rid !== restauranteId) return null;

    return { clienteId: cid, restauranteId: rid, nome };
  } catch {
    return null;
  }
}

export async function fecharContaDoCliente(): Promise<void> {
  const jar = await cookies();
  jar.delete(CLIENTE_COOKIE);
}
