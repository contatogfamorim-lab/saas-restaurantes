'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirPermissao } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';

/**
 * Configurações da casa (§8).
 *
 * A autorização de verdade está em `atualizar_configuracoes`, que cobra o papel
 * `owner` dentro do banco e registra a mudança no `audit_log`. O
 * `exigirPermissao` daqui é para o erro sair legível — Server Action é endpoint
 * HTTP público (§10.3), e uma checagem em TypeScript nunca foi proteção.
 */

export interface ResultadoConfig {
  ok: boolean;
  erro?: string;
}

const configuracoes = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto').max(80),
  // Percentuais, e não centavos: são taxas. A conversão para dinheiro acontece
  // no fechamento, sobre o total já congelado.
  taxaServico: z.coerce.number().min(0, 'No mínimo 0').max(30, 'No máximo 30%'),
  cashback: z.coerce.number().min(0, 'No mínimo 0').max(20, 'No máximo 20%'),
  timezone: z.string().trim().min(3).max(64),
  pedirTelefone: z.boolean(),
  cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor precisa ser hexadecimal'),

  /**
   * O nome da instância na Evolution API.
   *
   * Vazio é válido e significa DESCONECTAR — sem isso, quem apagasse o campo
   * ficaria com a instância antiga gravada e continuaria disparando por ela.
   *
   * O formato é apertado porque este valor vai direto para o CAMINHO de uma
   * URL. Barra ou ponto aqui viraria travessia de caminho na chamada à
   * Evolution. O banco repete a mesma regra, e é ele que decide.
   */
  whatsapp: z
    .string()
    .trim()
    .max(60)
    .regex(/^[A-Za-z0-9_-]*$/, 'Use só letras, números, hífen e sublinhado')
    .optional(),

  tetoDiario: z.coerce
    .number()
    .int()
    .min(0, 'No mínimo 0')
    .max(2000, 'No máximo 2000 por dia'),

  /** Horas até o saldo poder ser usado. 0 = vale na hora. */
  carencia: z.coerce.number().int().min(0, 'No mínimo 0').max(720, 'No máximo 30 dias'),

  /**
   * Dias até o saldo sumir. 0 = NUNCA expira, e é o padrão.
   *
   * O zero não é "campo vazio": é uma escolha, e é a escolha segura. Casa que
   * não decidiu não tira saldo de ninguém por omissão.
   */
  validade: z.coerce.number().int().min(0, 'No mínimo 0').max(3650, 'No máximo 10 anos'),
});

export async function salvarConfiguracoes(formData: FormData): Promise<ResultadoConfig> {
  const parsed = configuracoes.safeParse({
    nome: formData.get('nome'),
    taxaServico: formData.get('taxaServico'),
    // Caixa desmarcada não vem no FormData: a ausência É o zero, e ler
    // `formData.get('cashback')` sem este cuidado deixaria o campo escondido
    // mandar o valor antigo de volta.
    cashback: formData.get('cashbackLigado') === 'on' ? formData.get('cashback') : 0,
    timezone: formData.get('timezone'),
    pedirTelefone: formData.get('pedirTelefone') === 'on',
    cor: formData.get('cor'),
    // `?? ''` seria desconectar. O campo digitado virou painel de conexão e
    // não é mais enviado pelo formulário, então a AUSÊNCIA precisa significar
    // "não mexe" — e não "apague a instância". O `undefined` faz a chave nem
    // ser montada lá embaixo, e a função do banco preserva o valor atual.
    whatsapp: formData.get('whatsapp') ?? undefined,
    tetoDiario: formData.get('tetoDiario') ?? 200,
    carencia: formData.get('carencia') ?? 24,
    // Caixa desmarcada não vem no FormData, e a ausência É o zero — a mesma
    // pegadinha do cashback logo acima.
    validade: formData.get('validadeLigada') === 'on' ? formData.get('validade') : 0,
  });

  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  await exigirPermissao('restaurant.settings');

  const supabase = await createClient();
  const { error } = await supabase.rpc('atualizar_configuracoes', {
    p_valores: {
      nome: parsed.data.nome,
      taxa_servico: parsed.data.taxaServico,
      cashback: parsed.data.cashback,
      timezone: parsed.data.timezone,
      pedir_telefone: parsed.data.pedirTelefone,
      cor: parsed.data.cor,
      // Chave ausente é preservação, não apagamento — ver a 0055.
      ...(parsed.data.whatsapp === undefined ? {} : { whatsapp: parsed.data.whatsapp }),
      teto_diario: parsed.data.tetoDiario,
      carencia: parsed.data.carencia,
      validade: parsed.data.validade,
    },
  });

  if (error) return { ok: false, erro: error.message };

  // A cor da marca e o nome aparecem na casca de TODAS as telas da equipe, e a
  // taxa entra em toda conta aberta. Revalidar só esta página deixaria o resto
  // do sistema mostrando o valor velho até alguém recarregar.
  revalidatePath('/app', 'layout');

  return { ok: true };
}

/* -------------------------------------------------------------------------- *
 *  A CONEXÃO DO WHATSAPP
 *
 *  Antes disto o dono precisava de um `curl` no servidor para existir uma
 *  instância, e depois digitar o nome dela num campo de texto — errar uma letra
 *  produzia uma casa que aceita campanhas e nunca entrega nenhuma.
 *
 *  Todas as funções daqui cobram `restaurant.settings`, que é do dono. A chave
 *  da Evolution é lida do ambiente DENTRO destas funções e nunca sai do
 *  servidor: o navegador recebe estado, QR e erro em português — nunca a chave,
 *  nunca a URL do servidor, nunca a resposta crua.
 * -------------------------------------------------------------------------- */

import {
  conectar,
  criarInstancia,
  desconectar,
  estadoDaInstancia,
  nomeDaInstancia,
  recriarInstancia,
  type Conexao,
  type Estado,
} from '@/lib/marketing/instancia';

/*
 * POR QUE NENHUMA DESTAS AÇÕES CHAMA `revalidatePath`.
 *
 * Elas chamavam, e isso derrubava a tela de configurações iniciais.
 *
 * `revalidatePath` faz a página ATUAL ser re-renderizada no servidor junto com
 * a resposta da ação. O painel de conexão também aparece no fim do
 * `/comecar`, e aquela página decide o passo pelo estado real: com o
 * restaurante já montado, ela redireciona para `/app`. Resultado observado no
 * navegador: clicar em "Conectar WhatsApp" durante as configurações iniciais
 * jogava a pessoa no salão, sem QR nenhum e sem explicação.
 *
 * E a revalidação não servia para nada: `/app/gestao/configuracoes` e
 * `/app/gestao/campanhas` são `force-dynamic`, ou seja, já re-renderizam a
 * cada navegação. Quem atualiza a tela no instante do clique é o próprio
 * painel, com o estado que a ação devolve.
 */

export interface SituacaoWhatsApp {
  /** O nome que a instância TEM, ou `null` se a casa nunca conectou. */
  instancia: string | null;
  /**
   * `verificando` não é um estado da Evolution: é a tela dizendo que ainda não
   * perguntou. Existe porque a página de Configurações NÃO pode ficar
   * pendurada num servidor de terceiro — ver o comentário em `page.tsx`.
   */
  estado: Estado | 'verificando';
  qr?: string | null;
  codigo?: string | null;
  erro?: string;
}

/** Nome + id da casa de quem está logado, com a permissão já cobrada. */
async function casa(): Promise<{ id: string; nome: string; instancia: string | null }> {
  const staff = await exigirPermissao('restaurant.settings');
  const supabase = await createClient();
  const { data } = await supabase
    .from('restaurants')
    .select('name, evolution_instance_name')
    .eq('id', staff.restaurantId)
    .single();

  return {
    id: staff.restaurantId,
    nome: data?.name ?? '',
    instancia: data?.evolution_instance_name ?? null,
  };
}

/** Grava (ou apaga) o nome da instância passando pela função que audita. */
async function gravarInstancia(nome: string | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('atualizar_configuracoes', {
    p_valores: { whatsapp: nome ?? '' },
  });
  if (error) throw new Error(error.message);
}

/**
 * Como está a conexão agora.
 *
 * Pergunta à Evolution a cada abertura da tela em vez de confiar no que está
 * gravado. O banco só sabe que existe uma instância; se o WhatsApp caiu de
 * madrugada, quem sabe disso é a Evolution.
 */
export async function situacaoWhatsApp(): Promise<SituacaoWhatsApp> {
  const c = await casa();
  if (!c.instancia) return { instancia: null, estado: 'inexistente' };
  return { instancia: c.instancia, estado: await estadoDaInstancia(c.instancia) };
}

/**
 * Conectar: cria se precisar, aplica os ajustes, e só então devolve o QR.
 *
 * A ORDEM É A REGRA, não uma preferência de implementação — ver `AJUSTES` em
 * `lib/marketing/instancia.ts`. Se os ajustes falharem, esta função devolve
 * erro e NÃO devolve QR: um QR lido antes deles congela o comportamento errado
 * até alguém desconectar e parear de novo.
 */
export async function conectarWhatsApp(): Promise<SituacaoWhatsApp> {
  const c = await casa();
  const instancia = c.instancia ?? nomeDaInstancia(c.nome, c.id);

  const criada = await criarInstancia(instancia);
  if (!criada.ok) return { instancia: null, estado: 'indisponivel', erro: criada.erro };

  // Só grava depois de a instância existir COM os ajustes. Gravar antes
  // deixaria a casa com um nome apontando para o nada, e a tela de campanhas
  // diria "WhatsApp ligado".
  if (!c.instancia) await gravarInstancia(instancia);

  const conexao: Conexao = await conectar(instancia);

  return {
    instancia,
    estado: conexao.estado,
    qr: conexao.qr,
    codigo: conexao.codigo,
    erro: conexao.erro,
  };
}

/**
 * Começar de novo: apaga a instância e refaz.
 *
 * É o que resolve a sessão azeda — a que não conecta nem devolve QR. Custa o
 * pareamento: depois disto é obrigatório ler o QR outra vez.
 */
export async function recomecarWhatsApp(): Promise<SituacaoWhatsApp> {
  const c = await casa();
  const instancia = c.instancia ?? nomeDaInstancia(c.nome, c.id);

  const refeita = await recriarInstancia(instancia);
  if (!refeita.ok) return { instancia, estado: 'indisponivel', erro: refeita.erro };

  if (!c.instancia) await gravarInstancia(instancia);

  const conexao = await conectar(instancia);

  return {
    instancia,
    estado: conexao.estado,
    qr: conexao.qr,
    codigo: conexao.codigo,
    erro: conexao.erro,
  };
}

/**
 * Desligar o WhatsApp da casa.
 *
 * Desconecta o aparelho E apaga o nome gravado, nesta ordem. Fazer só o
 * primeiro deixaria as campanhas achando que há por onde enviar; fazer só o
 * segundo deixaria uma sessão pareada de pé, invisível, num servidor
 * compartilhado com outras casas.
 */
export async function desligarWhatsApp(): Promise<ResultadoConfig> {
  const c = await casa();
  if (!c.instancia) return { ok: true };

  await desconectar(c.instancia);
  await gravarInstancia(null);

  return { ok: true };
}
