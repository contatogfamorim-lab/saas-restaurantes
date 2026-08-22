import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { publicEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Client do funcionário logado — usa a chave ANON e o cookie de sessão do
 * Supabase Auth, então **a RLS continua valendo** em toda query.
 *
 * É este o client que as telas da equipe devem usar, inclusive para escrita.
 * Usar service_role para mutação de equipe desliga a camada de autorização do
 * banco e deixa a spec §12.9 (guarda de coluna em products) sem efeito.
 *
 * `cookies()` é assíncrono no Next 16 — daí o await.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component não pode escrever cookie. O middleware renova a
            // sessão, então ignorar aqui é seguro.
          }
        },
      },
    },
  );
}
