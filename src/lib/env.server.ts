import 'server-only';

import { z } from 'zod';

/**
 * Variáveis que NUNCA podem chegar ao browser (spec §2, §10.6).
 *
 * Arquivo separado do `env.ts` por um motivo concreto, encontrado por acidente:
 * quando os dois moravam juntos, qualquer Client Component que importasse
 * `publicEnv` arrastava o módulo inteiro para o bundle. Não vazava VALOR — o
 * Next só substitui `process.env.NEXT_PUBLIC_*` por literal, então o resto vira
 * `undefined` no browser — mas os NOMES iam junto, e `pnpm check:secrets`
 * acusava. Estava certo em acusar: a fronteira tinha caído, e no dia em que
 * alguém acrescentasse um `NEXT_PUBLIC_` por engano ali dentro, o valor iria.
 *
 * O `import 'server-only'` no topo é a guarda de verdade: importar isto de um
 * Client Component quebra o BUILD, não a produção.
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, 'SUPABASE_SERVICE_ROLE_KEY ausente ou truncada'),
  // assina o cookie httpOnly da sessão de mesa (spec §10.4)
  SESSION_COOKIE_SECRET: z
    .string()
    .min(32, 'SESSION_COOKIE_SECRET precisa de pelo menos 32 caracteres'),

  /**
   * WhatsApp (Evolution API) e o segredo do worker de campanhas.
   *
   * OPCIONAIS de propósito: uma instalação sem WhatsApp precisa subir. Se
   * fossem obrigatórias, quem só quer o cardápio e o caixa não conseguiria
   * fazer build — e a saída natural seria preencher com lixo, que é pior.
   *
   * A ausência é tratada onde importa: o worker é fail-closed sem o segredo, e
   * `iniciar_campanha` recusa sem instância configurada. Não há caminho em que
   * "faltou variável" vire "mandou mensagem errada".
   *
   * O piso de 24 caracteres no segredo não é enfeite. Sem piso, um
   * `MARKETING_WORKER_SECRET=1` passaria — e a rota que dispara campanha de
   * todos os restaurantes ficaria protegida por um dígito.
   */
  EVOLUTION_API_URL: z.string().url().optional(),
  EVOLUTION_API_KEY: z.string().min(8).optional(),
  MARKETING_WORKER_SECRET: z
    .string()
    .min(24, 'MARKETING_WORKER_SECRET precisa de pelo menos 24 caracteres')
    .optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cache: ServerEnv | undefined;

/**
 * Leitura preguiçosa e memoizada: validar no topo do módulo faria o build
 * inteiro quebrar por uma variável que talvez nem seja usada naquela rota.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() foi chamado no browser');
  }
  cache ??= serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET,
    EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || undefined,
    EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY || undefined,
    MARKETING_WORKER_SECRET: process.env.MARKETING_WORKER_SECRET || undefined,
  });
  return cache;
}
