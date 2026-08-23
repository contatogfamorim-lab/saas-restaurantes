import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

import { serverEnv } from '@/lib/env';

/**
 * Sessão de mesa do cliente (spec §10.4).
 *
 * Cookie httpOnly, SameSite=Lax e ASSINADO. A regra que sustenta tudo:
 *
 *   NUNCA aceitar session_id vindo de body, query string ou header.
 *
 * Só do cookie assinado. Aceitar de outro lugar é IDOR servido de bandeja —
 * bastaria trocar um uuid no request para ler e escrever na comanda da mesa
 * ao lado.
 *
 * Por isso este módulo não exporta nada que receba um session_id de fora: a
 * única forma de obter a sessão é `readTableSession()`, que lê o cookie.
 */

export const SESSION_COOKIE = 'mesa_sessao';
export const DEVICE_COOKIE = 'mesa_dispositivo';

/** 6 horas (spec §10.4) — ou até a mesa ser liberada, o que vier primeiro. */
const SESSION_TTL_SECONDS = 6 * 60 * 60;

/** O device é lembrado por mais tempo: é ele que evita repergunta na volta. */
const DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface TableSession {
  sessionId: string;
  guestId: string;
  restaurantId: string;
  tableId: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(serverEnv().SESSION_COOKIE_SECRET);
}

/** `Secure` quebraria o cookie em http://localhost durante o desenvolvimento. */
const isProduction = process.env.NODE_ENV === 'production';

export async function issueTableSession(session: TableSession): Promise<void> {
  const token = await new SignJWT({
    sid: session.sessionId,
    gid: session.guestId,
    rid: session.restaurantId,
    tid: session.tableId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * A sessão atual, ou `null`. Assinatura inválida, expirada ou adulterada cai
 * em `null` — nunca lança, porque um cookie velho não é erro do cliente, é o
 * fim natural de uma comanda.
 */
export async function readTableSession(): Promise<TableSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    const { sid, gid, rid, tid } = payload as Record<string, unknown>;

    if (
      typeof sid !== 'string' || typeof gid !== 'string' ||
      typeof rid !== 'string' || typeof tid !== 'string'
    ) {
      return null;
    }

    return { sessionId: sid, guestId: gid, restaurantId: rid, tableId: tid };
  } catch {
    return null;
  }
}

/** Usado ao liberar a mesa: o celular precisa perder a sessão na hora. */
export async function clearTableSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Identificador do aparelho.
 *
 * Um uuid aleatório que NÓS geramos, guardado em cookie — não é fingerprint.
 * Fingerprinting rastrearia a pessoa entre restaurantes e seria coleta que a
 * §10.9 manda evitar; este id morre quando o cliente limpa os cookies, e é
 * exatamente esse o comportamento desejado.
 *
 * No banco guardamos só o HASH: se a base vazar, ela não devolve o cookie de
 * ninguém.
 */
export async function readOrCreateDeviceHash(): Promise<string> {
  const jar = await cookies();
  let raw = jar.get(DEVICE_COOKIE)?.value;

  if (!raw || raw.length < 20) {
    raw = randomUUID();
    jar.set(DEVICE_COOKIE, raw, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: DEVICE_TTL_SECONDS,
    });
  }

  return createHash('sha256').update(raw).digest('hex');
}
