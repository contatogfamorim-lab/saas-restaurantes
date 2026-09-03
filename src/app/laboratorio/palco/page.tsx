import { connection } from 'next/server';
import { notFound } from 'next/navigation';

import { Bancada } from './bancada';

/**
 * Bancada de teste do palco 3D. Só existe em desenvolvimento.
 *
 * `connection()` força renderização por requisição. Não é capricho: a CSP em
 * `src/proxy.ts` manda `nonce` para toda rota fora de `PRE_RENDERIZADAS`, e
 * página materializada em HTML no build sai SEM nonce — a CSP então bloqueia
 * todo script dela, inclusive os chunks, e a tela fica branca sem explicação.
 * Ou a rota é dinâmica, ou entra naquela lista. Para uma bancada de teste,
 * dinâmica é o certo.
 */
export default async function Page() {
  await connection();
  if (process.env.NODE_ENV === 'production') notFound();
  return <Bancada />;
}
