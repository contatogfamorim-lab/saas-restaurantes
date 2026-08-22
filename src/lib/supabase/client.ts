'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Client de browser para as telas da EQUIPE (garçom, cozinha, caixa, gestão).
 * É por aqui que passam as assinaturas de Realtime — sempre escopadas por
 * `restaurant_id` (spec §9).
 *
 * O celular do CLIENTE não usa este client e não abre conexão Realtime: o
 * status dos itens vem por polling a cada 10s (spec §9). Com 500 conexões no
 * plano Pro, assinar o cliente derruba o teto de ~80 restaurantes para ~9.
 */
export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
