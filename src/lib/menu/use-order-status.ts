'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Acompanhamento do pedido por POLLING — nunca Realtime (spec §9).
 *
 * O orçamento de conexões do plano Pro é 500 para a plataforma inteira. Com o
 * celular do cliente assinando Realtime, uma casa de 20 mesas gastaria ~56 e
 * caberíamos em 9 restaurantes; com polling, em ~80. Todo mundo lota às 20h de
 * sábado, então o pico é simultâneo de verdade — não dá para contar com
 * diluição.
 *
 * O ciclo PARA sozinho em três situações, porque polling eterno é bateria do
 * cliente e egress nosso sem contrapartida:
 *  - a mesa foi liberada;
 *  - todos os itens já foram entregues;
 *  - 30 minutos sem interação (spec §9).
 */

const INTERVALO_MS = 10_000;
const OCIOSO_MS = 30 * 60 * 1000;

export interface ItemAcompanhado {
  id: string;
  nome: string;
  qty: number;
  status: string;
  comensal: string | null;
  meu: boolean;
}

export interface ConvidadoNaMesa {
  id: string;
  nome: string;
  euMesmo: boolean;
}

export interface TotaisComanda {
  subtotal_cents: number;
  pending_cents: number;
  service_fee_cents: number;
  total_cents: number;
}

interface Estado {
  ativo: boolean;
  encerrada: boolean;
  itens: ItemAcompanhado[];
  convidados: ConvidadoNaMesa[];
  totais: TotaisComanda | null;
  offline: boolean;
}

const VAZIO: Estado = {
  ativo: false,
  encerrada: false,
  itens: [],
  convidados: [],
  totais: null,
  offline: false,
};

const TERMINAIS = new Set(['delivered', 'cancelled', 'out_of_stock']);

export function useOrderStatus() {
  const [estado, setEstado] = useState<Estado>(VAZIO);
  // Inicia em 0 e é carimbado na montagem: `Date.now()` durante o render é
  // função impura, e o React Compiler recusa — com razão, porque render pode
  // acontecer mais de uma vez e o valor mudaria a cada uma.
  const ultimaInteracao = useRef(0);
  /**
   * Continuar polling só faz sentido enquanto existe comanda viva. Guardado em
   * ref, não em dependência do efeito: reassinar os listeners a cada ciclo de
   * 10s recriaria o intervalo e o ritmo deixaria de ser 10s.
   */
  const continuar = useRef(false);

  const buscar = useCallback(async () => {
    try {
      const res = await fetch('/api/pedidos/status', { cache: 'no-store' });

      if (res.status === 401) {
        // Ainda não há comanda: o cliente só está olhando o cardápio. Não faz
        // sentido continuar batendo no servidor a cada 10s.
        continuar.current = false;
        setEstado((e) => ({ ...e, ativo: false, offline: false }));
        return;
      }
      if (res.status === 410) {
        continuar.current = false;
        setEstado({ ...VAZIO, encerrada: true });
        return;
      }
      if (!res.ok) {
        setEstado((e) => ({ ...e, offline: true }));
        return;
      }

      const dados = await res.json();
      continuar.current = true;
      setEstado({
        ativo: true,
        encerrada: false,
        itens: dados.itens ?? [],
        convidados: dados.convidados ?? [],
        totais: dados.totais ?? null,
        offline: false,
      });
    } catch {
      // Wi-fi de restaurante cai. A tela avisa que está desatualizada em vez de
      // mentir em silêncio (spec §9), e o próximo ciclo tenta de novo.
      setEstado((e) => ({ ...e, offline: true }));
    }
  }, []);

  useEffect(() => {
    ultimaInteracao.current = Date.now();

    // Uma sondagem na montagem: o cliente pode estar voltando a uma comanda
    // que já existe (mesmo aparelho, mesma mesa), e aí a tela precisa mostrar
    // o pedido em andamento sem ele fazer nada.
    //
    // A regra `set-state-in-effect` acusa aqui, mas se engana: o setState
    // acontece DEPOIS do `await fetch`, não sincronamente no corpo do efeito —
    // a análise estática não atravessa o limite assíncrono. Buscar dado de um
    // sistema externo na montagem é exatamente o que um efeito deve fazer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar();

    const id = setInterval(() => {
      if (!continuar.current) return;
      if (document.hidden) return; // aba em segundo plano não gasta requisição
      if (Date.now() - ultimaInteracao.current > OCIOSO_MS) return;
      void buscar();
    }, INTERVALO_MS);

    const acordar = () => {
      ultimaInteracao.current = Date.now();
      if (continuar.current && !document.hidden) void buscar();
    };

    document.addEventListener('visibilitychange', acordar);
    window.addEventListener('focus', acordar);
    window.addEventListener('pointerdown', acordar, { passive: true });

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', acordar);
      window.removeEventListener('focus', acordar);
      window.removeEventListener('pointerdown', acordar);
    };
  }, [buscar]);

  const tudoEntregue =
    estado.itens.length > 0 && estado.itens.every((i) => TERMINAIS.has(i.status));

  return { ...estado, tudoEntregue, recarregar: buscar };
}
