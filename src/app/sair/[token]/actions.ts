'use server';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * A baixa de verdade.
 *
 * Server Action é endpoint HTTP público (§10). O que protege esta aqui não é o
 * fato de ser um POST — é o token: quem tem o token de alguém pode tirar aquela
 * pessoa da lista, e nada além disso. Sem sessão, sem escalada, sem enxergar
 * dado de ninguém.
 *
 * E o pior caso é benigno na comparação: a única coisa que um atacante com o
 * token consegue é fazer o restaurante PARAR de mandar mensagem. O erro cai
 * para o lado de menos mensagem, que é o lado certo.
 */
export async function sairDaLista(token: string): Promise<{ ok: boolean }> {
  // O token vem da URL e é a única credencial. O banco confere tamanho mínimo e
  // devolve `false` para o que não existir — sem dizer se existe, para o
  // resultado não virar um oráculo de tokens válidos.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('descadastrar_marketing', {
    p_token: token,
  });

  if (error) return { ok: false };
  return { ok: data === true };
}
