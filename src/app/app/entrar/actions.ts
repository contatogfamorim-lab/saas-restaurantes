'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Identificador vira HASH antes de chegar ao banco.
 *
 * O freio precisa contar tentativas, não saber de quem elas são. Guardar
 * e-mail e IP montaria, sem querer, o registro de quem tentou entrar de onde —
 * e a §10.10 é explícita sobre nunca registrar dado pessoal.
 *
 * SHA-256 sem sal de propósito: sal por tentativa quebraria a contagem (cada
 * tentativa viraria uma chave nova), e sal fixo não acrescenta nada aqui — o
 * espaço de e-mails é enumerável de qualquer jeito. O que este hash entrega é
 * que a tabela não seja legível como lista, não sigilo criptográfico.
 */
function digerir(valor: string): string {
  return createHash('sha256').update(valor.trim().toLowerCase()).digest('hex');
}

/**
 * De onde veio a tentativa.
 *
 * `x-forwarded-for` é controlado pelo cliente quando não há proxy confiável na
 * frente. Em produção atrás de um CDN ele é reescrito e vale; sem proxy, um
 * atacante forja o valor e escapa do balde de origem. Por isso o balde de
 * ORIGEM é o secundário: o que segura força bruta contra uma conta é o balde
 * de CONTA, que não depende de nada que o cliente possa mentir.
 */
async function origemDaTentativa(): Promise<string> {
  const h = await headers();
  const encaminhado = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return digerir(encaminhado || h.get('x-real-ip') || 'sem-origem');
}

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

  // O freio roda ANTES de resolver o e-mail e antes de tocar no GoTrue: se
  // rodasse depois, cada tentativa bloqueada ainda custaria uma consulta ao
  // banco e uma ida ao servidor de auth — que é metade do que a força bruta
  // quer conseguir.
  //
  // A chave é o que a pessoa DIGITOU, não o e-mail resolvido. Assim o balde
  // vale igual para quem tenta pelo código de operador e para quem tenta pelo
  // e-mail; usar o e-mail resolvido daria dois baldes para a mesma conta.
  const hashConta = digerir(parsed.data.usuario);
  const hashOrigem = await origemDaTentativa();

  const admin = createAdminClient();
  const { data: podeTentar } = await admin.rpc('login_permitido', {
    p_hash_conta: hashConta,
    p_hash_origem: hashOrigem,
  });

  if (podeTentar === false) {
    // Mesma tela de "usuário ou senha incorretos", com aviso de espera. Dizer
    // "esta conta está bloqueada" confirmaria que a conta existe — que é
    // exatamente o que quem está sondando quer descobrir.
    redirect('/app/entrar?erro=1&espere=1');
  }

  const email = await resolverEmail(parsed.data.usuario);
  if (!email) {
    // Código de operador inexistente conta como falha: sem isto, varrer "01",
    // "02", "03"… seria de graça, e é justamente essa varredura que descobre
    // quantas pessoas trabalham na casa.
    await admin.rpc('registrar_falha_de_login', {
      p_hash_conta: hashConta,
      p_hash_origem: hashOrigem,
    });
    redirect('/app/entrar?erro=1');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.senha,
  });

  if (error) {
    // Só a FALHA conta. Somar tentativa bem-sucedida ao balde trancaria quem
    // está simplesmente trabalhando num turno movimentado.
    await admin.rpc('registrar_falha_de_login', {
      p_hash_conta: hashConta,
      p_hash_origem: hashOrigem,
    });
    redirect('/app/entrar?erro=1');
  }

  // Deu certo: zera o balde da conta. Sem isto, quem erra sete vezes e acerta
  // na oitava fica a um palmo do bloqueio pelos dez minutos seguintes.
  await admin.rpc('liberar_freio_de_login', { p_hash_conta: hashConta });

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
