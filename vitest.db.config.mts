import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Testes contra o Postgres real (spec §10.11 e §16).
 *
 *   pnpm db:start && pnpm db:reset && pnpm test:db
 *
 * Um worker só: vários testes abrem transações sobre as mesmas linhas do seed,
 * e rodá-los em paralelo produziria deadlock em vez de falha de verdade.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
