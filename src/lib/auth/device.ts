import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Aparelho confiável — o que torna 5 dígitos aceitáveis (spec §10.5).
 *
 * Sem isto, `código + 5 dígitos` seria um endpoint público com 100 mil
 * combinações: um script varre tudo numa madrugada. Com o teclado numérico
 * aparecendo só em aparelho que o Administrador liberou, o atacante precisa
 * primeiro estar DENTRO do restaurante, com um tablet da casa na mão.
 *
 * O cookie guarda o token cru; o banco guarda só o SHA-256 dele. Base vazada
 * não devolve o acesso de nenhum aparelho.
 */

export const DEVICE_COOKIE = 'markello_aparelho';

/** Um ano: o tablet da cozinha não deveria pedir e-mail de novo por temporada. */
const DEVICE_TTL_SECONDS = 365 * 24 * 60 * 60;

const isProduction = process.env.NODE_ENV === 'production';

export interface AparelhoConfiavel {
  id: string;
  restaurantId: string;
  label: string;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * O aparelho atual, se estiver liberado e não revogado.
 *
 * Usa o client admin porque roda ANTES de existir sessão — é justamente o que
 * decide se a porta de operador aparece. RLS não ajudaria aqui: não há
 * `auth.uid()` ainda.
 */
export async function lerAparelhoConfiavel(): Promise<AparelhoConfiavel | null> {
  const jar = await cookies();
  const raw = jar.get(DEVICE_COOKIE)?.value;
  if (!raw || raw.length < 32) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from('trusted_devices')
    .select('id, restaurant_id, label, revoked_at')
    .eq('token_hash', hashToken(raw))
    .maybeSingle();

  if (!data || data.revoked_at) return null;

  return { id: data.id, restaurantId: data.restaurant_id, label: data.label };
}

/**
 * Libera este aparelho para uso por operadores.
 *
 * Chamado logo depois de um login de Administrador bem-sucedido: só quem provou
 * identidade com e-mail e senha pode transformar um aparelho em porta de
 * entrada.
 */
export async function liberarAparelho(
  restaurantId: string,
  criadoPor: string,
  label: string,
): Promise<void> {
  const raw = randomBytes(32).toString('base64url');

  const admin = createAdminClient();
  const { error } = await admin.from('trusted_devices').insert({
    restaurant_id: restaurantId,
    label: label.trim().slice(0, 60) || 'Aparelho da equipe',
    token_hash: hashToken(raw),
    created_by: criadoPor,
    last_seen_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Não foi possível liberar o aparelho: ${error.message}`);

  const jar = await cookies();
  jar.set(DEVICE_COOKIE, raw, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_TTL_SECONDS,
  });
}

/** Marca atividade — alimenta a lista de aparelhos que o Administrador revoga. */
export async function registrarUsoDoAparelho(deviceId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('trusted_devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', deviceId);
}
