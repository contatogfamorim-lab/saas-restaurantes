import { z } from 'zod';

/**
 * Variáveis que podem ir para o browser (spec §2).
 *
 * As de SERVIDOR ficam em `env.server.ts`, e a separação não é organização: um
 * Client Component que importe daqui arrasta este módulo inteiro para o bundle.
 * Enquanto os dois schemas moravam juntos, o do servidor ia junto — ver o
 * comentário em `env.server.ts`.
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

export type PublicEnv = z.infer<typeof publicSchema>;

let cache: PublicEnv | undefined;

/**
 * Leitura preguiçosa e memoizada: validar no topo do módulo faria o build
 * inteiro quebrar por uma variável que talvez nem seja usada naquela rota. Do
 * jeito que está, o erro aparece no primeiro uso real e diz o que falta.
 */
function readPublicEnv(): PublicEnv {
  cache ??= publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return cache;
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
