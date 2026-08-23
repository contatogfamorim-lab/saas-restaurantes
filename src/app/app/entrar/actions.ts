'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { liberarAparelho } from '@/lib/auth/device';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const credenciais = z.object({
  email: z.email(),
  senha: z.string().min(1).max(200),
  de: z.string().startsWith('/app').max(200).catch('/app'),
  liberarAparelho: z.boolean(),
  apelidoAparelho: z.string().max(60).optional(),
});

/**
 * Login do Administrador.
 *
 * O destino pós-login é validado com `startsWith('/app')`: aceitar um `de`
 * arbitrário transformaria esta tela em redirecionador aberto, útil para
 * phishing — o link parece do sistema e joga a pessoa em outro lugar.
 */
export async function entrar(formData: FormData) {
  const parsed = credenciais.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
    de: formData.get('de'),
    liberarAparelho: formData.get('liberarAparelho') === 'on',
    apelidoAparelho: formData.get('apelidoAparelho') || undefined,
  });

  if (!parsed.success) redirect('/app/entrar?admin=1&erro=1');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.senha,
  });

  if (error || !data.user) redirect('/app/entrar?admin=1&erro=1');

  // Liberar aparelho é privilégio de quem administra. Um gerente que entrasse
  // por aqui não pode transformar o próprio celular numa porta permanente da
  // casa — quem faz isso responde pela conta (spec §10.5).
  if (parsed.data.liberarAparelho) {
    const admin = createAdminClient();
    const { data: perfil } = await admin
      .from('profiles')
      .select('restaurant_id, roles')
      .eq('id', data.user.id)
      .maybeSingle();

    if (perfil?.roles?.includes('owner')) {
      await liberarAparelho(
        perfil.restaurant_id,
        data.user.id,
        parsed.data.apelidoAparelho ?? 'Aparelho da equipe',
      );
    }
  }

  redirect(parsed.data.de);
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Volta para a porta certa: em aparelho liberado, o teclado do operador.
  // Fazer a cozinha reencontrar o formulário de e-mail a cada troca de turno
  // seria desfazer o motivo de o aparelho ter sido liberado.
  redirect('/app/operador');
}
