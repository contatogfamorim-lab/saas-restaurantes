import 'server-only';

import { verify } from '@node-rs/argon2';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { lerAparelhoConfiavel, registrarUsoDoAparelho } from './device';

/**
 * Entrada por código de operador + senha de 5 dígitos.
 *
 * Três camadas, e a ausência de qualquer uma derruba as outras (spec §10.5):
 *
 *   1. APARELHO. O teclado só existe em aparelho liberado pelo Administrador.
 *   2. BLOQUEIO. 5 erros travam o operador por 15 minutos, contados no banco.
 *   3. AUDITORIA. Toda tentativa falha fica registrada.
 *
 * No fim, o operador recebe uma sessão REAL do Supabase Auth — não um cookie
 * paralelo nosso. Isso importa: todas as policies de RLS dependem de
 * `auth.uid()`, e uma sessão caseira deixaria o operador sem RLS, que é
 * exatamente a camada que impede um garçom de ler a comanda de outro
 * restaurante.
 */

export type FalhaOperador =
  | 'aparelho_nao_liberado'
  | 'credencial_invalida'
  | 'bloqueado'
  | 'erro_interno';

export interface ResultadoOperador {
  ok: boolean;
  falha?: FalhaOperador;
  /** Só quando bloqueado: quantos minutos faltam. */
  minutosRestantes?: number;
  destino?: string;
}

export async function entrarComoOperador(
  codigo: string,
  senha: string,
): Promise<ResultadoOperador> {
  const aparelho = await lerAparelhoConfiavel();
  if (!aparelho) return { ok: false, falha: 'aparelho_nao_liberado' };

  if (!/^[0-9]{2,6}$/.test(codigo) || !/^[0-9]{5}$/.test(senha)) {
    return { ok: false, falha: 'credencial_invalida' };
  }

  const admin = createAdminClient();

  const { data: perfil } = await admin
    .from('profiles')
    .select('id, name, pin_hash, active, pin_locked_until, restaurant_id')
    .eq('restaurant_id', aparelho.restaurantId)
    .eq('operator_code', codigo)
    .maybeSingle();

  // Código inexistente e senha errada devolvem a MESMA resposta. Distinguir os
  // dois entregaria a lista de códigos válidos da casa a quem estivesse
  // tentando — e o código fica no crachá, mas a confirmação de quais existem
  // não precisa ser de graça.
  if (!perfil || !perfil.active || !perfil.pin_hash) {
    return { ok: false, falha: 'credencial_invalida' };
  }

  if (perfil.pin_locked_until && new Date(perfil.pin_locked_until) > new Date()) {
    const faltam = Math.ceil(
      (new Date(perfil.pin_locked_until).getTime() - Date.now()) / 60_000,
    );
    return { ok: false, falha: 'bloqueado', minutosRestantes: faltam };
  }

  const confere = await verify(perfil.pin_hash, senha).catch(() => false);

  if (!confere) {
    const { data: resultado } = await admin.rpc('register_pin_failure', {
      p_profile_id: perfil.id,
    });
    const r = resultado as { bloqueado?: boolean; bloqueado_ate?: string } | null;

    if (r?.bloqueado && r.bloqueado_ate) {
      const faltam = Math.ceil((new Date(r.bloqueado_ate).getTime() - Date.now()) / 60_000);
      return { ok: false, falha: 'bloqueado', minutosRestantes: faltam };
    }
    return { ok: false, falha: 'credencial_invalida' };
  }

  // --- credencial boa: emite sessão real do Supabase -------------------------
  const sessao = await criarSessao(perfil.id);
  if (!sessao) return { ok: false, falha: 'erro_interno' };

  await admin.rpc('register_pin_success', { p_profile_id: perfil.id });
  await registrarUsoDoAparelho(aparelho.id);

  return { ok: true, destino: '/app' };
}

/**
 * Cria uma sessão do Supabase Auth para um perfil, sem senha.
 *
 * `generateLink` produz um token de uso único no servidor de auth, e
 * `verifyOtp` o troca pelo cookie de sessão. O e-mail existe no `auth.users`
 * mas o operador nunca o digita — é identificador interno, não credencial.
 */
async function criarSessao(profileId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: usuario, error: erroUsuario } =
    await admin.auth.admin.getUserById(profileId);

  if (erroUsuario || !usuario?.user?.email) return false;

  const { data: link, error: erroLink } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: usuario.user.email,
  });

  if (erroLink || !link?.properties?.hashed_token) return false;

  const supabase = await createClient();
  const { error: erroVerify } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });

  return !erroVerify;
}
