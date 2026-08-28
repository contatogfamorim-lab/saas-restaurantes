'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { exigirPermissao } from '@/lib/auth/staff';
import { createClient } from '@/lib/supabase/server';

/**
 * As ações da tela de campanhas.
 *
 * Nenhuma delas usa `service_role`. Todas passam pelo client de sessão, com a
 * RLS ligada e o papel de quem clicou — e a autorização de verdade está nas
 * funções do banco, que cobram `owner` ou `manager`.
 *
 * Server Action é endpoint HTTP público (§10.3). O Zod daqui é a mensagem
 * bonita; quem recusa é o Postgres.
 */

interface Resultado {
  ok: boolean;
  erro?: string;
  /** Quantas pessoas entraram no público, quando a ação devolve isso. */
  quantos?: number;
}

const CAMINHO = '/app/gestao/campanhas';

/**
 * Traduz o erro do banco para uma frase.
 *
 * Devolver `error.message` cru mostraria "new row violates row-level security
 * policy for table..." para o dono de um restaurante, que não tem como fazer
 * nada com isso. Os códigos vêm da 0050.
 */
function emPortugues(mensagem: string): string {
  if (/42501|permission denied|row-level security/i.test(mensagem)) {
    return 'Você não tem permissão para isso.';
  }
  if (/45120/.test(mensagem)) return 'Campanha não encontrada.';
  if (/45121/.test(mensagem)) return 'O público só é montado antes de começar.';
  if (/45122/.test(mensagem)) return 'Esta campanha não está parada.';
  if (/45123/.test(mensagem)) return 'Não há ninguém para receber. Monte o público antes.';
  if (/45124/.test(mensagem)) return 'Conecte o WhatsApp nas configurações antes de disparar.';
  // As mensagens das funções já vêm em português; o resto é ruído de driver.
  const limpa = mensagem.replace(/^.*?:\s*/, '').trim();
  return limpa.length > 0 && limpa.length < 160 ? limpa : 'Não deu certo.';
}

const rascunho = z.object({
  titulo: z.string().trim().min(2, 'Dê um nome à campanha').max(80),
  corpo: z
    .string()
    .trim()
    .min(10, 'A mensagem está curta demais')
    .max(900, 'A mensagem passou de 900 caracteres'),
});

export async function criarCampanha(formData: FormData): Promise<Resultado> {
  const parsed = rascunho.safeParse({
    titulo: formData.get('titulo') ?? '',
    corpo: formData.get('corpo') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  // `restaurant_id` NÃO vem do formulário: vem da sessão. Mandar o id daqui
  // seria dar ao navegador a chance de escolher a casa — a policy recusaria,
  // mas a tentativa nem deve existir.
  //
  // E vem de `exigirPermissao`, não de uma consulta a `profiles`. A primeira
  // versão fazia `.from('profiles').select('restaurant_id').maybeSingle()` e
  // quebrava na cara do dono com "Sessão sem restaurante": o dono enxerga
  // TODOS os perfis da casa, então a consulta devolve várias linhas e o
  // `maybeSingle()` vira erro — que eu tratei como "não tem perfil".
  const staff = await exigirPermissao('campaign.manage');

  const supabase = await createClient();
  const { error } = await supabase.from('message_campaigns').insert({
    restaurant_id: staff.restaurantId,
    titulo: parsed.data.titulo,
    corpo: parsed.data.corpo,
  });

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true };
}

export async function editarCampanha(
  id: string,
  formData: FormData,
): Promise<Resultado> {
  const parsed = rascunho.safeParse({
    titulo: formData.get('titulo') ?? '',
    corpo: formData.get('corpo') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createClient();

  // Só rascunho. Editar uma campanha em andamento não mudaria o que já saiu —
  // o texto é congelado por destinatário — e deixaria na tela um corpo que não
  // corresponde a nenhuma mensagem enviada.
  const { error, count } = await supabase
    .from('message_campaigns')
    .update(
      { titulo: parsed.data.titulo, corpo: parsed.data.corpo, updated_at: new Date().toISOString() },
      { count: 'exact' },
    )
    .eq('id', id)
    .eq('status', 'draft');

  if (error) return { ok: false, erro: emPortugues(error.message) };
  if (!count) return { ok: false, erro: 'Só dá para editar antes de disparar.' };

  revalidatePath(CAMINHO);
  return { ok: true };
}

/**
 * Quantas pessoas um segmento alcança AGORA.
 *
 * Vem do servidor, da mesma função que monta o público. Estimar no navegador
 * seria mais rápido e prometeria um número que a fila não cumpre.
 */
export async function contarSegmento(segmento: unknown): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('contar_segmento', {
    p_segmento: segmento as never,
  });
  if (error) return 0;
  return (data as number) ?? 0;
}

export async function montarPublico(
  id: string,
  segmento?: unknown,
): Promise<Resultado> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('montar_publico', {
    p_campanha: id,
    // `undefined` faz a função reusar o segmento já gravado — que é o
    // comportamento certo para "refazer a lista".
    p_segmento: (segmento ?? undefined) as never,
  });

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true, quantos: (data as number) ?? 0 };
}

export async function dispararCampanha(
  id: string,
  quando?: string,
): Promise<Resultado> {
  const supabase = await createClient();

  // Agendamento no passado vira "agora". O contrário — recusar — obrigaria a
  // pessoa a acertar o relógio contra o servidor, e a mensagem de erro seria
  // sobre fuso horário em vez de sobre a campanha.
  const marcado = quando && new Date(quando).getTime() > Date.now() ? quando : undefined;

  const { data, error } = await supabase.rpc('iniciar_campanha', {
    p_campanha: id,
    p_quando: marcado,
  });

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true, quantos: (data as number) ?? 0 };
}

export async function pararCampanha(
  id: string,
  definitivo: boolean,
): Promise<Resultado> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('parar_campanha', {
    p_campanha: id,
    p_definitivo: definitivo,
  });

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true };
}

export async function apagarRascunho(id: string): Promise<Resultado> {
  const supabase = await createClient();

  // Rascunho e só. Campanha que já mandou mensagem não some: os destinatários
  // com `sent` são o registro de quem recebeu o quê, e apagar isso apagaria a
  // prova junto com o incômodo.
  const { error, count } = await supabase
    .from('message_campaigns')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('status', 'draft');

  if (error) return { ok: false, erro: emPortugues(error.message) };
  if (!count) return { ok: false, erro: 'Só rascunho pode ser apagado.' };

  revalidatePath(CAMINHO);
  return { ok: true };
}

const TIPOS = ['liberou', 'vai_expirar', 'sumido'] as const;

/**
 * Liga, desliga e reescreve um aviso automático.
 *
 * `upsert` porque a linha pode não existir: a tela mostra os três tipos sempre,
 * inclusive os que a casa nunca tocou. Criar as três linhas no nascimento do
 * restaurante seria a alternativa, e deixaria restaurante antigo sem elas.
 */
export async function salvarGatilho(
  kind: string,
  ativo: boolean,
  corpo: string,
  dias: number,
): Promise<Resultado> {
  if (!TIPOS.includes(kind as (typeof TIPOS)[number])) {
    return { ok: false, erro: 'Tipo de aviso desconhecido' };
  }
  const texto = corpo.trim();
  if (texto.length < 10 || texto.length > 900) {
    return { ok: false, erro: 'A mensagem precisa ter entre 10 e 900 caracteres' };
  }

  const staff = await exigirPermissao('campaign.manage');
  const supabase = await createClient();

  const { error } = await supabase.from('message_triggers').upsert(
    {
      restaurant_id: staff.restaurantId,
      kind,
      ativo,
      corpo: texto,
      dias: Math.min(Math.max(Math.round(dias) || 60, 1), 3650),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'restaurant_id,kind' },
  );

  if (error) return { ok: false, erro: emPortugues(error.message) };

  revalidatePath(CAMINHO);
  return { ok: true };
}
