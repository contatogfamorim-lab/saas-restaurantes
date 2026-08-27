import { publicEnv } from '@/lib/env';

/**
 * Caminho no Storage → URL pública.
 *
 * O banco guarda o CAMINHO (`{restaurante}/arquivo.webp`), nunca a URL inteira
 * — é o que permite trocar de projeto Supabase sem reescrever linha por linha.
 *
 * Existe uma versão desta função no servidor (`lib/supabase/storage.ts`), que
 * usa o SDK. Esta é para o componente de cliente, que não tem o SDK à mão e só
 * precisa montar a string.
 */
export function urlDaImagem(caminho: string): string {
  if (caminho.startsWith('http') || caminho.startsWith('blob:')) return caminho;
  return `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-photos/${caminho}`;
}
