import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/env.server';
import type { Database } from './database.types';

/**
 * Client com service_role. **IGNORA RLS.**
 *
 * `import 'server-only'` faz o build FALHAR se este módulo for importado por
 * um Client Component — a chave nunca chega ao browser (spec §2).
 *
 * Use apenas onde o chamador não é um funcionário autenticado e a autorização
 * já foi feita à mão:
 *
 *  - Route Handlers do cardápio do cliente, DEPOIS de validar o cookie
 *    assinado da sessão de mesa
 *  - resolver /m/[short_code] → mesa → restaurante (restaurant_tables não tem
 *    policy para anon, de propósito)
 *  - jobs de sistema (religar "acabou hoje", expurgo de telefone)
 *
 * NÃO use para mutação de tela de equipe: isso desligaria a RLS e os guardas
 * de coluna que dependem de auth.uid(). Para equipe, use
 * `@/lib/supabase/server`.
 */
export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
