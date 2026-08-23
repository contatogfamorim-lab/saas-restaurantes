'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { CartLine } from './cart';

/**
 * Carrinho persistido no `localStorage`.
 *
 * `useSyncExternalStore` em vez de `useState` + `useEffect` porque o
 * localStorage É um store externo — ler no efeito significaria renderizar uma
 * vez com o carrinho vazio antes de mostrar o pedido, e a barra do carrinho
 * piscaria a cada abertura.
 *
 * De brinde, `getServerSnapshot` resolve o SSR sem erro de hidratação, e o
 * evento `storage` sincroniza abas: o cliente que abriu o cardápio duas vezes
 * vê o mesmo pedido nas duas.
 */

const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();

/**
 * Cache de identidade. `getSnapshot` PRECISA devolver a mesma referência
 * enquanto o dado não muda — `JSON.parse` novo a cada chamada faria o React
 * entrar em laço infinito de render.
 */
let cache: { key: string; raw: string | null; value: CartLine[] } | null = null;

function readCart(key: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (cache && cache.key === key && cache.raw === raw) return cache.value;

    const parsed = raw ? (JSON.parse(raw) as unknown) : EMPTY;
    const value = Array.isArray(parsed) ? (parsed as CartLine[]) : EMPTY;
    cache = { key, raw, value };
    return value;
  } catch {
    // localStorage bloqueado (aba anônima, cookies restritos) ou JSON corrompido.
    // O cardápio continua funcionando — só não lembra do pedido.
    return EMPTY;
  }
}

function writeCart(key: string, lines: CartLine[]) {
  let raw: string | null = null;
  try {
    raw = JSON.stringify(lines);
    window.localStorage.setItem(key, raw);
  } catch {
    // sem persistência: mantém em memória para esta sessão
    raw = null;
  }
  cache = { key, raw, value: lines };
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useCart(
  storageKey: string,
): [CartLine[], (update: CartLine[] | ((prev: CartLine[]) => CartLine[])) => void] {
  const lines = useSyncExternalStore(
    subscribe,
    () => readCart(storageKey),
    () => EMPTY,
  );

  const setLines = useCallback(
    (update: CartLine[] | ((prev: CartLine[]) => CartLine[])) => {
      const next =
        typeof update === 'function'
          ? (update as (prev: CartLine[]) => CartLine[])(readCart(storageKey))
          : update;
      writeCart(storageKey, next);
    },
    [storageKey],
  );

  return [lines, setLines];
}
