'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { abrirContaDoCliente, fecharContaDoCliente, lerContaDoCliente } from '@/lib/session/cliente';
import { readTableSession } from '@/lib/session/cookie';

/**
 * Conta do cliente e cashback, do lado do servidor.
 *
 * TRÊS REGRAS QUE VALEM PARA TODAS AS AÇÕES DAQUI:
 *
 * 1. o `restaurant_id` vem do `short_code` da mesa, nunca do formulário. Deixar
 *    o navegador escolher a casa seria deixá-lo abrir conta — e gastar saldo —
 *    no restaurante que quisesse;
 *
 * 2. o `customer_id` vem do cookie assinado, nunca do corpo (§10.4). É a mesma
 *    regra do `session_id`, e aqui ela guarda dinheiro;
 *
 * 3. o VALOR do resgate nunca vem do cliente (§10.1). O celular manda "quero
 *    usar meu saldo"; quem calcula quanto é o banco, pelo teto de 30%.
 */

interface Resultado {
  ok: boolean;
  erro?: string;
  /** Nome de quem entrou — a folha de pedido usa para não perguntar de novo. */
  nome?: string;
}

/** Descobre a casa a partir do código da mesa — jamais do formulário. */
async function restauranteDaMesa(shortCode: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('restaurant_tables')
    .select('restaurant_id, restaurants(active)')
    .eq('short_code', shortCode)
    .eq('active', true)
    .maybeSingle();

  const casa = data?.restaurants as unknown as { active: boolean } | null;
  if (!data || !casa?.active) return null;
  return data.restaurant_id;
}

const cadastro = z.object({
  cpf: z.string().transform((v) => v.replace(/\D/g, '')),
  nome: z.string().trim().min(2, 'Informe seu nome').max(80),
  senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(200),
  telefone: z.string().transform((v) => v.replace(/\D/g, '')).optional(),
  email: z.string().trim().max(160).optional(),
});

export async function criarConta(shortCode: string, formData: FormData): Promise<Resultado> {
  const parsed = cadastro.safeParse({
    cpf: formData.get('cpf') ?? '',
    nome: formData.get('nome') ?? '',
    senha: formData.get('senha') ?? '',
    telefone: formData.get('telefone') ?? '',
    email: formData.get('email') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const restaurante = await restauranteDaMesa(shortCode);
  if (!restaurante) return { ok: false, erro: 'Mesa não encontrada' };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('cadastrar_cliente', {
    p_restaurante: restaurante,
    p_cpf: parsed.data.cpf,
    p_nome: parsed.data.nome,
    p_senha: parsed.data.senha,
    // `undefined` e não `null`: o tipo gerado pelo Supabase declara os dois
    // opcionais como `string | undefined`, e o default da função no banco já
    // resolve a ausência.
    p_telefone: parsed.data.telefone || undefined,
    p_email: parsed.data.email || undefined,
  });

  if (error) return { ok: false, erro: error.message };

  await abrirContaDoCliente({
    clienteId: data as string,
    restauranteId: restaurante,
    nome: parsed.data.nome,
  });
  await vincularNaMesa(data as string);

  revalidatePath(`/m/${shortCode}/conta`);
  return { ok: true, nome: parsed.data.nome };
}

export async function entrarNaConta(shortCode: string, formData: FormData): Promise<Resultado> {
  const cpf = String(formData.get('cpf') ?? '').replace(/\D/g, '');
  const senha = String(formData.get('senha') ?? '');

  const restaurante = await restauranteDaMesa(shortCode);
  if (!restaurante) return { ok: false, erro: 'Mesa não encontrada' };

  const admin = createAdminClient();

  // O MESMO freio da equipe (§10.6). Sem ele, o CPF vira um espaço de busca de
  // onze dígitos e a senha, o único obstáculo — e ninguém está olhando.
  const hashConta = await digerir(`cliente:${restaurante}:${cpf}`);
  const { data: podeTentar } = await admin.rpc('login_permitido', {
    p_hash_conta: hashConta,
    p_hash_origem: hashConta,
  });
  if (podeTentar === false) {
    return { ok: false, erro: 'Muitas tentativas. Espere alguns minutos.' };
  }

  const { data: clienteId, error } = await admin.rpc('autenticar_cliente', {
    p_restaurante: restaurante,
    p_cpf: cpf,
    p_senha: senha,
  });

  if (error || !clienteId) {
    await admin.rpc('registrar_falha_de_login', {
      p_hash_conta: hashConta,
      p_hash_origem: hashConta,
    });
    // Mensagem única: distinguir "CPF não cadastrado" de "senha errada" diria a
    // quem estiver sondando quais CPFs têm conta nesta casa.
    return { ok: false, erro: 'CPF ou senha incorretos' };
  }

  await admin.rpc('liberar_freio_de_login', { p_hash_conta: hashConta });

  const { data: cliente } = await admin
    .from('customers')
    .select('name')
    .eq('id', clienteId as string)
    .maybeSingle();

  await abrirContaDoCliente({
    clienteId: clienteId as string,
    restauranteId: restaurante,
    nome: cliente?.name ?? 'Cliente',
  });
  await vincularNaMesa(clienteId as string);

  revalidatePath(`/m/${shortCode}/conta`);
  return { ok: true, nome: cliente?.name ?? 'Cliente' };
}

export async function sairDaConta(shortCode: string): Promise<Resultado> {
  await fecharContaDoCliente();
  revalidatePath(`/m/${shortCode}/conta`);
  return { ok: true };
}

/**
 * Liga a conta ao lugar em que a pessoa está sentada.
 *
 * Sem isto o cashback não teria a quem ser creditado no fim da noite, e o
 * resgate seria recusado — `resgatar_cashback` exige que o cliente esteja
 * nesta mesa, que é o que impede gastar saldo na conta alheia.
 *
 * A sessão vem do cookie assinado da MESA, nunca de parâmetro (§10.4).
 */
async function vincularNaMesa(clienteId: string): Promise<void> {
  const mesa = await readTableSession();
  if (!mesa) return;

  const admin = createAdminClient();
  await admin
    .from('session_guests')
    .update({ customer_id: clienteId })
    .eq('id', mesa.guestId);
}

export async function usarSaldo(shortCode: string): Promise<Resultado> {
  const restaurante = await restauranteDaMesa(shortCode);
  if (!restaurante) return { ok: false, erro: 'Mesa não encontrada' };

  const conta = await lerContaDoCliente(restaurante);
  if (!conta) return { ok: false, erro: 'Entre na sua conta primeiro' };

  const mesa = await readTableSession();
  if (!mesa) return { ok: false, erro: 'Abra a mesa antes' };

  const admin = createAdminClient();
  // Repare no que NÃO é passado: valor nenhum. O banco calcula.
  const { error } = await admin.rpc('resgatar_cashback', {
    p_sessao: mesa.sessionId,
    p_cliente: conta.clienteId,
  });

  if (error) return { ok: false, erro: error.message };

  revalidatePath(`/m/${shortCode}/conta`);
  return { ok: true };
}

export async function devolverSaldo(shortCode: string): Promise<Resultado> {
  const restaurante = await restauranteDaMesa(shortCode);
  if (!restaurante) return { ok: false, erro: 'Mesa não encontrada' };

  const conta = await lerContaDoCliente(restaurante);
  const mesa = await readTableSession();
  if (!conta || !mesa) return { ok: false, erro: 'Sem conta ou sem mesa' };

  const admin = createAdminClient();
  const { error } = await admin.rpc('desfazer_resgate', {
    p_sessao: mesa.sessionId,
    p_cliente: conta.clienteId,
  });

  if (error) return { ok: false, erro: error.message };

  revalidatePath(`/m/${shortCode}/conta`);
  return { ok: true };
}

/** Hash estável para o balde do freio, sem guardar o CPF em lugar nenhum. */
async function digerir(valor: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(valor).digest('hex');
}
