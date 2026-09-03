import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Decodificador Draco: código de terceiro, minificado, copiado de
    // `node_modules/three` por `public/draco/LEIA-ME.md`. Não é nosso para
    // arrumar, e a cada atualização do `three` ele volta como veio.
    "public/draco/**",
  ]),
]);

export default eslintConfig;
