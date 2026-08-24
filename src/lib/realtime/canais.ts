/**
 * Que mudança acorda que tela (spec §9).
 *
 * Está aqui, e não espalhado nos `page.tsx`, pelo mesmo motivo da matriz de
 * permissões: uma lista dessas errada não quebra nada — a tela só para de
 * atualizar. Ninguém percebe no `pnpm build`, ninguém percebe na review, e o
 * garçom descobre num sábado à noite que o pedido não apareceu.
 *
 * `tests/db/realtime.test.ts` importa ESTE arquivo e roda os quatro cenários
 * da §9 contra ele: encena a ação de verdade, coleta o que foi publicado e
 * confere se a tela que precisava saber tinha a tabela na lista. Se alguém
 * tirar uma tabela daqui, o teste cai.
 */
export const TABELAS_POR_TELA = {
  /** Cenários 1, 3 e 4: pedido novo, prato pronto na passagem, mesa chamando. */
  salao: ['orders', 'order_items', 'waiter_calls', 'table_sessions'],

  /** Cenário 2: garçom aprovou, tem que entrar na fila de produção agora. */
  cozinha: ['order_items', 'table_sessions'],

  /** Cenário 4: "pediu a conta" tem que subir para o topo da fila do caixa. */
  caixa: ['order_items', 'waiter_calls', 'payments', 'table_sessions'],
} as const satisfies Record<string, readonly string[]>;

export type Tela = keyof typeof TABELAS_POR_TELA;
