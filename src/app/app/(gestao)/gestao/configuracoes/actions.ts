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
    .regex(/^[A-Za-z0-9_-]*$/, 'Use só letras, números, hífen e sublinhado'),

  tetoDiario: z.coerce
    .number()
    .int()
    .min(0, 'No mínimo 0')
    .max(2000, 'No máximo 2000 por dia'),
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
    whatsapp: formData.get('whatsapp') ?? '',
    tetoDiario: formData.get('tetoDiario') ?? 200,
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
      whatsapp: parsed.data.whatsapp,
      teto_diario: parsed.data.tetoDiario,
    },
  });

  if (error) return { ok: false, erro: error.message };

  // A cor da marca e o nome aparecem na casca de TODAS as telas da equipe, e a
  // taxa entra em toda conta aberta. Revalidar só esta página deixaria o resto
  // do sistema mostrando o valor velho até alguém recarregar.
  revalidatePath('/app', 'layout');

  return { ok: true };
}
