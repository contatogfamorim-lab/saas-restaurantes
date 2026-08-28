'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { exigirStaff, getStaff } from '@/lib/auth/staff';
import { COZINHAS, FUSOS } from '@/lib/onboarding/briefing';
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

const briefing = z.object({
  tipoCozinha: z.enum(COZINHAS.map((c) => c.valor) as [string, ...string[]]),
  cidade: z.string().trim().max(80),
  timezone: z.enum(FUSOS.map((f) => f.valor) as [string, ...string[]]),
  mesas: z.coerce.number().int().min(1, 'No mínimo 1').max(200, 'No máximo 200'),
  // Percentual, não centavos: é uma taxa, não um valor. A conversão para
  // dinheiro acontece no fechamento, sobre o total já congelado.
  taxaServico: z.coerce.number().min(0).max(30),
  pedirTelefone: z.coerce.boolean(),
  gerarDemo: z.coerce.boolean(),
  // Percentual devolvido ao cliente cadastrado. 0 = sem cashback, e é o padrão.
  // O teto de 20 é reapertado dentro de `aplicar_briefing` — este é só a
  // mensagem legível (§10.3).
  cashback: z.coerce.number().min(0).max(20),
});

export interface ResultadoBriefing extends ResultadoOnboarding {
  produtosCriados?: number;
  mesasCriadas?: number;
  /** Só na demonstração: quando aquele restaurante inteiro deixa de existir. */
  expiraEm?: string;
}

/**
 * Responde o briefing e monta o restaurante a partir das respostas.
 *
 * Duas chamadas RPC, nesta ordem e por um motivo: `aplicar_briefing` cria o
 * cardápio SEM preço e fora do ar, que é o correto para uma casa de verdade;
 * `gerar_demonstracao` só depois põe preço e movimento em cima do que já existe.
 * A demo é uma camada sobre o briefing, nunca um caminho paralelo — assim não
 * há dois geradores de restaurante para manter em pé.
 *
 * Nada aqui confia no cliente: o percentual da taxa é reapertado dentro da
 * função do banco (`least(greatest(v_taxa, 0), 30)`), a contagem de mesas
 * também, e as duas funções cobram o papel `owner` na entrada. O Zod acima é
 * para a mensagem sair legível (§10.3: Server Action é endpoint público).
 */
export async function responderBriefing(formData: FormData): Promise<ResultadoBriefing> {
  const parsed = briefing.safeParse({
    tipoCozinha: formData.get('tipoCozinha'),
    cidade: formData.get('cidade') ?? '',
    timezone: formData.get('timezone'),
    mesas: formData.get('mesas'),
    taxaServico: formData.get('taxaServico'),
    pedirTelefone: formData.get('pedirTelefone') === 'on',
    gerarDemo: formData.get('gerarDemo') === 'on',
    // Caixa desmarcada não vem no FormData, e a ausência É o zero. Ler
    // `cashback` direto deixaria o campo escondido mandar o valor antigo.
    cashback: formData.get('cashbackLigado') === 'on' ? (formData.get('cashback') ?? 0) : 0,
  });

  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  // `getStaff()` e não `exigirStaff()`: esta é a ação que ABRE o portão das
  // configurações iniciais, e o portão mora dentro de `exigirStaff`. Chamá-lo
  // aqui seria a ação se redirecionando para a tela que a chamou.
  //
  // Isto não afrouxa nada. A autorização de verdade está em
  // `aplicar_configuracoes_iniciais`, que cobra o papel `owner` dentro do
  // banco, sob RLS — esta linha só faz o erro sair legível quando não há
  // ninguém logado (§10.3).
  if (!(await getStaff())) return { ok: false, erro: 'Faça login de novo' };

  const supabase = await createClient();

  // `tipo_cozinha` NÃO vai mais junto, e a ausência é a mudança inteira.
  //
  // O tipo servia para o sistema inventar um cardápio de hamburgueria genérica
  // e entregá-lo como se fosse o da casa. Desde a 0059 o restaurante de verdade
  // nasce com cardápio VAZIO: o sistema não sabe o que aquela casa vende, e
  // fingir que sabe fazia o primeiro trabalho do dono ser apagar.
  //
  // O tipo continua existindo para a DEMONSTRAÇÃO, logo abaixo — lá ele
  // escolhe entre cinco casas fictícias, que é outra coisa.
  const { data: aplicado, error } = await supabase.rpc('aplicar_configuracoes_iniciais', {
    p_respostas: {
      cidade: parsed.data.cidade,
      timezone: parsed.data.timezone,
      mesas: parsed.data.mesas,
      taxa_servico: parsed.data.taxaServico,
      pedir_telefone: parsed.data.pedirTelefone,
      cashback: parsed.data.cashback,
    },
  });

  if (error) return { ok: false, erro: error.message };

  const resumo = (aplicado ?? {}) as { mesas_criadas?: number; produtos_criados?: number };

  if (!parsed.data.gerarDemo) {
    return {
      ok: true,
      mesasCriadas: resumo.mesas_criadas ?? 0,
      produtosCriados: resumo.produtos_criados ?? 0,
    };
  }

  // MARCA O PRAZO ANTES, em chamada própria.
  //
  // `gerar_demonstracao` é uma transação só: se ela falhar no meio, TUDO o que
  // escreveu é desfeito — inclusive um `expires_at` que estivesse lá dentro. Foi
  // assim que a produção ficou com um restaurante de demonstração marcado como
  // permanente, que a faxina não reconhecia.
  //
  // Esta chamada commita sozinha. Falha depois dela deixa para trás um
  // restaurante que expira, que é o que quem marcou a caixa pediu.
  const { error: erroMarca } = await supabase.rpc('marcar_como_demonstracao');
  if (erroMarca) return { ok: false, erro: erroMarca.message };

  // O TIPO agora escolhe a demonstração, e não o cardápio da casa: são cinco
  // restaurantes fictícios diferentes — pizzaria, hamburgueria, oriental,
  // açaiteria e balada — porque são cinco negócios que aparecem diferente na
  // tela, e quem está avaliando quer se ver ali dentro.
  const { data: demo, error: erroDemo } = await supabase.rpc('gerar_demonstracao', {
    p_tipo: parsed.data.tipoCozinha,
  });

  // As configurações já foram aplicadas quando isto falha, e o restaurante está de pé
  // com cardápio. Dizer "não deu certo" e deixar a pessoa achar que precisa
  // recomeçar seria mentir sobre o estado do banco.
  if (erroDemo) {
    return {
      ok: true,
      erro: `O restaurante foi criado, mas a demonstração falhou: ${erroDemo.message}`,
      mesasCriadas: resumo.mesas_criadas ?? 0,
      produtosCriados: resumo.produtos_criados ?? 0,
    };
  }

  // A contagem de produtos vem da DEMONSTRAÇÃO, e não das configurações
  // iniciais: desde a 0059 elas não criam produto nenhum, e ler dali daria
  // sempre zero — que a tela mostraria como se fosse uma falha.
  const gerada = (demo ?? {}) as { produtos?: number; expira_em?: string };

  return {
    ok: true,
    mesasCriadas: resumo.mesas_criadas ?? 0,
    produtosCriados: gerada.produtos ?? 0,
    expiraEm: gerada.expira_em,
  };
}

/** Termina o onboarding no editor de cardápio, que é o próximo trabalho real. */
export async function concluir() {
  await exigirStaff();
  redirect('/app/cardapio');
}
