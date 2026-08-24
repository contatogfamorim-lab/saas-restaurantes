'use server';

import { z } from 'zod';

import { exigirPermissao } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';

/**
 * Revela o telefone completo de um cliente (spec §10.9).
 *
 * TRÊS CAMADAS, e nenhuma delas confia na anterior:
 *
 *   1. aqui, `exigirPermissao('customer.view_full_phone')` — porque Server
 *      Action é endpoint HTTP público, e esconder o botão não protege nada;
 *   2. no banco, `reveal_guest_phone` confere o papel de novo e filtra por
 *      restaurante, porque a função é SECURITY DEFINER e não passa por RLS;
 *   3. o GRANT de coluna, que impede o caminho cru `select phone from
 *      session_guests` para todo mundo, administrador incluído.
 *
 * O registro em audit_log acontece dentro da função do banco, na MESMA
 * transação da leitura. Registrar aqui deixaria uma janela onde o telefone sai
 * e o rastro não entra — e é justamente no erro que o rastro importa.
 *
 * Este módulo exporta SÓ funções assíncronas. Um `export const` aqui dentro
 * derruba a tela em runtime, e o erro não diz por quê — já aconteceu neste
 * projeto (ver `lib/salao/motivos.ts`).
 */
export async function revelarTelefone(
  _anterior: { telefone?: string; erro?: string } | null,
  formData: FormData,
): Promise<{ telefone?: string; erro?: string }> {
  await exigirPermissao('customer.view_full_phone');

  const parsed = z.uuid().safeParse(formData.get('guestId'));
  if (!parsed.success) return { erro: 'Cliente inválido.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('reveal_guest_phone', {
    p_guest_id: parsed.data,
  });

  if (error) {
    // A mensagem do Postgres pode carregar detalhe interno; a tela recebe uma
    // frase fixa, e o motivo real fica no log do servidor.
    console.error('reveal_guest_phone falhou', { code: error.code });
    return { erro: 'Não foi possível mostrar o telefone.' };
  }

  return data ? { telefone: formatarTelefone(data) } : { erro: 'Sem telefone cadastrado.' };
}

/** "11987654321" → "(11) 98765-4321". Guardado limpo, exibido legível. */
function formatarTelefone(digitos: string): string {
  const d = digitos.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
