'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const credenciais = z.object({
  usuario: z.string().trim().min(1).max(200),
  senha: z.string().min(1).max(200),
  de: z.string().startsWith('/app').max(200).catch('/app'),
});

/**
 * Login da equipe — usuário e senha, igual para todo mundo.
 *
 * "Usuário" aceita duas formas:
 *   • o e-mail completo;
 *   • o código curto do crachá (`02`), que o servidor troca pelo e-mail.
 *
 * A troca acontece AQUI, no servidor, e não no browser: o código é público
 * dentro da casa, mas a lista de códigos válidos de um restaurante não precisa
 * ser confirmável de fora.
 *
 * O destino pós-login é validado com `startsWith('/app')` — aceitar um `de`
 * arbitrário transformaria esta tela em redirecionador aberto, útil para
 * phishing: o link parece do sistema e joga a pessoa em outro lugar.
 */
export async function entrar(formData: FormData) {
  const parsed = credenciais.safeParse({
    usuario: formData.get('usuario'),
    senha: formData.get('senha'),
    de: formData.get('de'),
  });

  if (!parsed.success) redirect('/app/entrar?erro=1');

  const email = await resolverEmail(parsed.data.usuario);
  if (!email) redirect('/app/entrar?erro=1');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.senha,
  });

  if (error) redirect('/app/entrar?erro=1');

  redirect(parsed.data.de);
}

/**
 * Descobre o e-mail a partir do que a pessoa digitou.
 *
 * Código não encontrado devolve `null`, e a tela mostra a MESMA mensagem de
 * senha errada. Distinguir "esse código não existe" de "senha incorreta"
 * entregaria a lista de quem trabalha na casa a quem estiver sondando.
 */
async function resolverEmail(usuario: string): Promise<string | null> {
  if (usuario.includes('@')) return usuario;

  if (!/^[0-9]{2,6}$/.test(usuario)) return null;

  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from('profiles')
    .select('id')
    .eq('operator_code', usuario)
    .eq('active', true)
    .maybeSingle();

  if (!perfil) return null;

  const { data } = await admin.auth.admin.getUserById(perfil.id);
  return data?.user?.email ?? null;
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/app/entrar');
}
