'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

/**
 * Realtime das telas da equipe (spec §9).
 *
 * O canal só diz QUE mudou, nunca o que: `{ tabela, op }`. Ao receber, a tela
 * pede uma recarga ao servidor, que a monta sob RLS como sempre. Nenhum dado de
 * comanda atravessa o socket.
 *
 * Orçamento de conexões: uma por tela aberta, ~6 por restaurante. O celular do
 * cliente NÃO entra aqui — ele usa polling de 10s, e é o que faz o teto do
 * plano Pro caber em ~80 restaurantes em vez de 9.
 */

export type EstadoConexao = 'conectando' | 'conectado' | 'perdido';

interface Opcoes {
  restaurantId: string;
  /** Só recarrega quando uma destas tabelas muda. */
  tabelas: readonly string[];
  /**
   * Rajada de eventos vira UMA recarga. Aprovar um pedido de 6 itens dispara 7
   * eventos em milissegundos; recarregar 7 vezes seria pior que não ter
   * realtime.
   */
  agruparMs?: number;
}

export function useRealtime({ restaurantId, tabelas, agruparMs = 300 }: Opcoes) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoConexao>('conectando');

  // `tabelas` chega como prop de Server Component: array novo a cada render, com
  // o mesmo conteúdo. Usar o array na lista de dependências derrubaria e
  // recriaria a conexão a cada recarga — e conexão é justamente o recurso
  // escasso aqui. A string derivada é estável, então o canal sobrevive.
  const chave = tabelas.join(',');

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const interessa = new Set(chave.split(','));
    const supabase = createClient();
    let cancelado = false;
    let canal: ReturnType<typeof supabase.channel> | null = null;

    async function conectar() {
      // O Realtime precisa do JWT do funcionário para a policy de
      // `realtime.messages` conseguir avaliar `app.current_restaurant_id()`.
      // Sem isto o canal privado é recusado — e recusado é o comportamento
      // certo: sem identidade, não há restaurante a que pertencer.
      await supabase.realtime.setAuth();
      if (cancelado) return;

      // `private: true` obriga a passar pela policy (migration 0028).
      canal = supabase.channel(`restaurante:${restaurantId}`, {
        config: { private: true },
      });

      canal
        .on('broadcast', { event: 'mudanca' }, ({ payload }) => {
          const tabela = (payload as { tabela?: string })?.tabela;
          if (!tabela || !interessa.has(tabela)) return;

          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => router.refresh(), agruparMs);
        })
        .subscribe((status) => {
          if (cancelado) return;

          if (status === 'SUBSCRIBED') {
            setEstado('conectado');
            // Ao (re)conectar, recarrega: enquanto esteve fora, a tela ficou
            // mentindo. É o cenário de wi-fi ruim que a §9 manda tratar.
            router.refresh();
          } else if (status === 'CLOSED') {
            setEstado('perdido');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setEstado('perdido');
          }
        });
    }

    void conectar();

    return () => {
      cancelado = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (canal) void supabase.removeChannel(canal);
    };
  }, [restaurantId, chave, agruparMs, router]);

  return estado;
}
