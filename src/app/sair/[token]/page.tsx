import type { Metadata } from 'next';

import { createAdminClient } from '@/lib/supabase/admin';
import { BotaoDeSaida } from './botao';

export const metadata: Metadata = {
  title: 'Sair da lista',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * "Não quero mais receber."
 *
 * Esta página é o que torna o disparo legítimo. Sem um jeito de sair que
 * funcione sem login, sem app e sem responder mensagem, a lista deixa de ser
 * uma lista de gente que quer receber e vira uma de gente que não conseguiu
 * escapar.
 *
 * ELA NÃO DESCADASTRA NINGUÉM.
 *
 * Este arquivo só LÊ. A baixa acontece no botão, que é um POST. A tentação é
 * fazer o `/sair/{token}` dar baixa direto e mostrar "pronto, você saiu" — um
 * toque a menos, e parece mais gentil.
 *
 * Seria um vazamento silencioso na direção contrária: WhatsApp, iMessage,
 * Outlook e antivírus corporativo abrem os links das mensagens sozinhos para
 * montar a pré-visualização. Todos eles fazem GET. A lista esvaziaria sozinha,
 * o dono do restaurante veria o alcance despencar sem explicação, e o log
 * mostraria saídas de gente que nunca tocou no celular.
 *
 * Por isso a leitura e a escrita são funções separadas no banco, e a de leitura
 * é `stable` — o Postgres recusa escrita dentro dela, e há teste que confere
 * essa marcação.
 */
export default async function Sair({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const admin = createAdminClient();
  const { data } = await admin.rpc('dono_do_token', { p_token: token });
  const dono = Array.isArray(data) ? data[0] : null;

  if (!dono) {
    return (
      <Moldura>
        <h1 className="font-display text-2xl leading-tight">Link inválido</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          Este link não vale mais, ou foi copiado pela metade. Se você quer parar
          de receber mensagens, responda a última que recebeu pedindo para sair —
          a casa consegue tirar você da lista.
        </p>
      </Moldura>
    );
  }

  if (dono.ja_saiu) {
    return (
      <Moldura>
        <h1 className="font-display text-2xl leading-tight">Você já saiu</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {dono.restaurante} não vai mandar mais mensagens de promoção para você.
        </p>
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          Se ainda assim chegar alguma, foi erro nosso — e o pedido de saída fica
          registrado com data e hora.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <h1 className="font-display text-2xl leading-tight">
        Parar de receber de {dono.restaurante}?
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        {dono.nome ? `${dono.nome}, você` : 'Você'} não vai mais receber avisos de
        cashback, promoções nem eventos.
      </p>

      <BotaoDeSaida token={token} />

      <p className="mt-6 text-[13px] leading-relaxed text-muted-foreground">
        Sua conta e o seu saldo de cashback continuam como estão — sair da lista
        não apaga nada, só para as mensagens.
      </p>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      {children}
    </main>
  );
}
