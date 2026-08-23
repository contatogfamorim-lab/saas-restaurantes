'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

const credenciais = z.object({
  email: z.email(),
  senha: z.string().min(1).max(200),
  de: z.string().startsWith('/app').max(200).catch('/app'),
});

/**
 * Login da equipe.
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
  });

  if (!parsed.success) redirect('/app/entrar?erro=1');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.senha,
  });

  if (error) redirect('/app/entrar?erro=1');

  redirect(parsed.data.de);
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/app/entrar');
}
