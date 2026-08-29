/**
 * `server-only` é uma trava de BUILD: o pacote real lança se alguém importar o
 * módulo a partir de um bundle de cliente. Dentro do Vitest não existe bundle
 * de cliente, e o pacote real quebraria a importação de qualquer arquivo de
 * servidor — inclusive os que têm lógica pura que vale a pena testar.
 *
 * Trocar por um módulo vazio NÃO enfraquece a trava: quem faz valer a regra é o
 * `next build`, e ele continua usando o pacote de verdade.
 */
export {};
