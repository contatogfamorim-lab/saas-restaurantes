import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Testes unitários — rodam sem banco, em qualquer máquina, em milissegundos.
 * Os testes que precisam do Postgres vivem em `tests/db/` e têm config própria
 * (`vitest.db.config.mts`), para que `pnpm test` nunca dependa de infraestrutura.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/*.test.ts'],
  },
});
