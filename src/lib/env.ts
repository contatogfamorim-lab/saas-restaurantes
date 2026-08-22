import { z } from 'zod';

/**
 * Validação de ambiente na fronteira de entrada (spec §2).
 *
 * Separado por propósito: o público pode ir para o browser, o de servidor
 * NUNCA. Se `SUPABASE_SERVICE_ROLE_KEY` ganhasse prefixo `NEXT_PUBLIC_` viraria
 * bundle — por isso `pnpm check:secrets` varre o build e falha o deploy.
 *
 * A leitura é preguiçosa e memoizada. Validar no topo do módulo faria o build
 * inteiro quebrar por uma variável que talvez nem seja usada naquela rota; do
 * jeito que está, o erro aparece no primeiro uso real e diz exatamente o que
 * falta.
 *
 * `process.env.X` é escrito por extenso de propósito: o Next substitui as
 * `NEXT_PUBLIC_*` por valor literal em tempo de build, e só reconhece o acesso
 * estático — `process.env[nome]` não é substituído.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    error: 'NEXT_PUBLIC_SUPABASE_URL precisa ser uma URL válida',
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY ausente ou truncada'),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, 'SUPABASE_SERVICE_ROLE_KEY ausente ou truncada'),
  // assina o cookie httpOnly da sessão de mesa (spec §10.4)
  SESSION_COOKIE_SECRET: z
    .string()
    .min(32, 'SESSION_COOKIE_SECRET precisa de pelo menos 32 caracteres'),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

let publicCache: PublicEnv | undefined;
let serverCache: ServerEnv | undefined;

function readPublicEnv(): PublicEnv {
  publicCache ??= publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return publicCache;
}

/** Seguro no browser e no servidor. */
export const publicEnv: PublicEnv = {
  get NEXT_PUBLIC_SUPABASE_URL() {
    return readPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() {
    return readPublicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY;
  },
};

/** Só em código de servidor. Lança se alguém importar isto no browser. */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() foi chamado no browser');
  }
  serverCache ??= serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET,
  });
  return serverCache;
}
