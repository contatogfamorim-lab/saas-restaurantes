import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { rodadaDeEnvio } from '@/lib/marketing/enviar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * O motor do disparo. Chamado em laço por um processo de fora — nunca pelo
 * navegador, e nunca por um funcionário.
 *
 * Cada chamada faz três coisas:
 *
 *   1. promove campanhas agendadas cuja hora chegou;
 *   2. manda UMA mensagem;
 *   3. diz em quantos milissegundos vale a pena chamar de novo.
 *
 * POR QUE UMA SÓ
 *
 * O intervalo entre mensagens é a proteção do número de WhatsApp da casa.
 * Mandar em rajada dentro de um tick anularia esse intervalo — e o número
 * bloqueado não é um bug que se conserta com deploy: é o telefone da casa
 * fora do ar, com os clientes reais dentro dele.
 *
 * `app.reservar_proximo_envio()` já escolhe uma campanha por vez, com
 * `for update skip locked`. Chamar esta rota duas vezes em paralelo é seguro:
 * a segunda chamada pega outra campanha, ou não pega nada.
 */

const OCIOSO_MS = 15_000;
const TETO_MS = 60_000;

/**
 * Fail-closed.
 *
 * Sem `MARKETING_WORKER_SECRET` configurado, NINGUÉM entra — nem em
 * desenvolvimento. A tentação é liberar quando a configuração falta, "para não
 * atrapalhar"; o resultado seria um endereço público capaz de disparar
 * campanha de qualquer restaurante, sem sessão, a partir de qualquer lugar.
 *
 * O segredo é comparado por igualdade simples. Não é `timingSafeEqual` porque
 * o que protegeria contra ataque de tempo aqui não é o `===`: é o fato de que
 * cada tentativa custa uma ida à rede, e o segredo é longo e aleatório.
 * Assumir proteção onde ela não existe seria pior que não ter.
 */
function autorizado(req: Request): boolean {
  const segredo = process.env.MARKETING_WORKER_SECRET;
  if (!segredo || segredo.length < 24) return false;
  return req.headers.get('authorization') === `Bearer ${segredo}`;
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // 1. Agendamentos vencidos entram na fila.
    //
    // No CRM de origem isto dependia de a tela estar aberta na hora marcada, e
    // agendar de noite para a manhã seguinte simplesmente não acontecia.
    const { data: promovidas } = await admin.rpc('promover_agendadas');

    // 1b. Os gatilhos automáticos enchem a fila.
    //
    // Rodam AQUI, e não num cron próprio, porque a fila é a mesma: o que eles
    // produzem é campanha, e campanha é o que este laço já sabe mandar. Um
    // agendador separado teria que reimplementar o intervalo, o teto e a
    // reconferência de consentimento — ou passar por cima dos três.
    //
    // Rodar a cada tick é barato: as consultas são indexadas e a idempotência
    // por evento faz a segunda passada não produzir nada.
    const { data: gatilhos } = await admin.rpc('rodar_gatilhos');

    // 2. Uma mensagem.
    const enviou = await rodadaDeEnvio();

    // 3. Quando chamar de novo. Quem sabe é o banco: é ele que guarda o
    //    próximo horário de cada campanha em andamento.
    const { data: proxima } = await admin
      .from('message_campaigns')
      .select('next_send_at')
      .eq('status', 'sending')
      .not('next_send_at', 'is', null)
      .order('next_send_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let emMs = OCIOSO_MS;
    if (proxima?.next_send_at) {
      const delta = new Date(proxima.next_send_at).getTime() - Date.now();
      emMs = Math.max(1000, Math.min(TETO_MS, delta));
    }

    return NextResponse.json({
      ok: true,
      promovidas: promovidas ?? 0,
      gatilhos: gatilhos ?? {},
      enviou: Boolean(enviou),
      emMs,
    });
  } catch (e) {
    // O worker precisa continuar vivo. Devolver 500 faria o processo de fora
    // tratar como queda e, dependendo de como estiver escrito, parar de
    // chamar — deixando campanhas paradas até alguém perceber.
    console.error('[marketing] tick falhou', (e as Error).message);
    return NextResponse.json({ ok: false, emMs: OCIOSO_MS }, { status: 200 });
  }
}

/** Sonda de saúde: o processo de fora confere URL e segredo ao subir. */
export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    whatsapp: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
  });
}
