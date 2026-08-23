import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Client ANÔNIMO usado no servidor, sem sessão de usuário.
 *
 * É o client do cardápio público. Usa a chave anon, então **a RLS vale** — e é
 * exatamente isso que se quer aqui: as policies de `categories` e `products` já
 * filtram por disponibilidade e janela de horário (spec §4, cardápio dinâmico).
 * A categoria "Happy Hour" fora das 17h–20h simplesmente não volta na query;
 * não existe `if` na aplicação decidindo isso, e portanto não existe `if`
 * errado.
 *
 * Não confundir com `@/lib/supabase/admin`, que ignora RLS. Aqui, o pior caso
 * de um bug é o cardápio vir vazio — nunca dado de outra mesa.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
