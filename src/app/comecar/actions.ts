'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { exigirStaff } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';

/**
 * Onboarding (spec §14).
 *
 * As duas escritas que o sistema não conseguia fazer sozinho passam por aqui, e
 * as duas chamam função do banco em vez de escrever direto:
 *
 *   `create_restaurant` — resolve o ovo e a galinha (ninguém pode criar
 *   restaurante nem o primeiro perfil, porque as policies negam);
 *   `create_tables`     — cria as mesas com `short_code` aleatório.
 *
 * O que NÃO acontece aqui: nenhuma policy foi afrouxada para o onboarding
 * funcionar. `restaurants` continua sem INSERT para qualquer papel, e as duas
 * funções cobram na entrada o que a policy não teria como cobrar.
 */

export interface ResultadoOnboarding {
  ok: boolean;
  erro?: string;
  /**
   * Preenchido quando a conta foi criada mas ainda NÃO há sessão — o projeto
   * exige confirmação por e-mail. Sem isto o wizard ficaria parado no passo 1
   * sem explicar nada: `signUp` teria dado certo, `getUser()` continuaria
   * nulo, e a página redesenharia o mesmo formulário.
   */
  confirmarEmail?: boolean;
}

const conta = z.object({
  email: z.email('E-mail inválido'),
  // O piso de 8 é o do Supabase. Não invento um teto nem exijo símbolo: regra
  // de complexidade empurra a pessoa para "Senha@123", que é pior que uma
  // frase longa.
  senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(200),
});

/**
 * Cria a conta de quem vai administrar.
 *
 * Só a conta — o restaurante vem no passo seguinte. Separar os dois deixa o
 * erro de cada um no lugar certo: e-mail já cadastrado é problema da conta, e
 * nome de restaurante é problema do restaurante.
 */
export async function criarConta(formData: FormData): Promise<ResultadoOnboarding> {
  const parsed = conta.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
  });

  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.senha,
  });

  if (error) {
    // A mensagem do GoTrue vai como veio. Traduzir para um genérico esconderia
    // "senha vazada em base de dados conhecida", que é exatamente o que a
    // pessoa precisa ler.
    return { ok: false, erro: error.message };
  }

  // Projeto com confirmação de e-mail ligada devolve usuário SEM sessão. É o
  // padrão em produção e o oposto do ambiente local, então é o caso que passa
  // despercebido até o primeiro cliente de verdade tentar entrar.
  if (!data.session) return { ok: true, confirmarEmail: true };

  return { ok: true };
}

const restaurante = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto').max(80),
  seuNome: z.string().trim().min(2, 'Informe seu nome').max(80),
});

export async function criarRestaurante(formData: FormData): Promise<ResultadoOnboarding> {
  const parsed = restaurante.safeParse({
    nome: formData.get('nome'),
    seuNome: formData.get('seuNome'),
  });

  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createClient();

  // O SLUG não vai daqui. É derivado do nome dentro da função, no servidor:
  // deixar o cliente escolher o endereço público é deixar alguém registrar
  // `brasa-burger` antes do Brasa Burger.
  const { error } = await supabase.rpc('create_restaurant', {
    p_nome: parsed.data.nome,
    p_nome_do_administrador: parsed.data.seuNome,
  });

  if (error) return { ok: false, erro: error.message };

  return { ok: true };
}

const mesas = z.object({
  quantidade: z.coerce.number().int().min(1, 'No mínimo 1').max(200, 'No máximo 200'),
  area: z.string().trim().max(40),
});

export async function criarMesas(formData: FormData): Promise<ResultadoOnboarding> {
  const parsed = mesas.safeParse({
    quantidade: formData.get('quantidade'),
    area: formData.get('area') || 'Salão',
  });

  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  // Server Action é endpoint HTTP público (spec §10.3). A função do banco
  // confere o papel de novo — esta linha é para o erro sair legível, não para
  // ser a proteção.
  await exigirStaff();

  const supabase = await createClient();
  const { error } = await supabase.rpc('create_tables', {
    p_quantidade: parsed.data.quantidade,
    p_area: parsed.data.area,
  });

  if (error) return { ok: false, erro: error.message };

  return { ok: true };
}

/** Termina o onboarding no editor de cardápio, que é o próximo trabalho real. */
export async function concluir() {
  await exigirStaff();
  redirect('/app/cardapio');
}
