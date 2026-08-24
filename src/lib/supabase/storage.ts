import type { SupabaseClient } from '@supabase/supabase-js';

export const BUCKET_FOTOS = 'product-photos';

/**
 * `products.image_url` guarda o CAMINHO no bucket, não a URL inteira.
 *
 * Assim o mesmo dado serve local, staging e produção sem reescrita (migration
 * 0015). Gravar a URL absoluta parece igual e não é: no dia em que o projeto
 * mudar de domínio, toda foto do banco aponta para o endereço antigo, e a
 * correção é um UPDATE em massa que ninguém lembra de fazer.
 *
 * A função mora aqui, e não em cada consulta, porque a regra é uma só e já foi
 * escrita duas vezes de formas diferentes — o editor de cardápio chegou a
 * gravar a URL completa, e a lista quebrou com "Failed to parse src" porque o
 * `next/image` recebeu um caminho relativo vindo do seed. Uma convenção
 * atendida em metade do código é pior que nenhuma.
 */
export function urlPublicaDaFoto(
  supabase: SupabaseClient,
  valor: string | null | undefined,
): string | null {
  if (!valor) return null;

  // Tolera o registro antigo com URL absoluta, caso algum tenha escapado.
  if (/^https?:\/\//i.test(valor)) return valor;

  return supabase.storage.from(BUCKET_FOTOS).getPublicUrl(valor).data.publicUrl;
}
