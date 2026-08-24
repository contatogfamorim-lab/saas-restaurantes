/**
 * Recorte de tempo do console (spec §8).
 *
 * Módulo à parte, SEM `server-only`, porque o seletor é Client Component e
 * precisa da mesma lista. Deixar isto em `queries.ts` faz o cliente arrastar um
 * módulo marcado `server-only` e o build quebra com uma mensagem que fala de
 * Pages Router — que não tem nada a ver com a causa.
 *
 * É a terceira vez que este projeto tropeça na mesma pedra: `lib/salao/motivos`
 * e `lib/caixa/tipos` existem pelo mesmo motivo. Constante compartilhada entre
 * servidor e cliente mora sozinha.
 */
export const PERIODOS = [7, 30, 90] as const;
export type Periodo = (typeof PERIODOS)[number];

/** Qualquer coisa fora da lista cai no padrão — inclusive lixo na query string. */
export function normalizarPeriodo(bruto: string | undefined): Periodo {
  const n = Number(bruto);
  return (PERIODOS as readonly number[]).includes(n) ? (n as Periodo) : 7;
}
