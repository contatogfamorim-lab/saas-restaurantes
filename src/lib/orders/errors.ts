/**
 * Tradução dos SQLSTATEs das funções de pedido para resposta HTTP.
 *
 * Cada falha vira uma frase que o cliente entende e um status correto. A
 * alternativa — devolver 500 e "erro interno" — faz a pessoa tentar de novo,
 * falhar de novo e chamar o garçom achando que o sistema quebrou.
 *
 * A mensagem vem do banco (é lá que está o contexto: qual prato, qual grupo),
 * e este mapa decide apenas o status e o código estável para o cliente.
 */

export const ORDER_ERRORS = {
  '45001': { status: 409, code: 'sessao_fechada' },
  '45002': { status: 403, code: 'convidado_invalido' },
  '45003': { status: 409, code: 'produto_indisponivel' },
  '45004': { status: 422, code: 'modificador_invalido' },
  '45005': { status: 422, code: 'escolha_obrigatoria' },
  '45006': { status: 422, code: 'quantidade_invalida' },
  '45007': { status: 409, code: 'promocao_esgotada' },
  '45008': { status: 422, code: 'pedido_vazio' },
  '45009': { status: 429, code: 'muitos_pedidos' },
  '45010': { status: 404, code: 'mesa_nao_encontrada' },
  '45011': { status: 409, code: 'precisa_garcom' },
  '45012': { status: 422, code: 'telefone_obrigatorio' },
  '45013': { status: 422, code: 'nome_invalido' },
} as const;

export type OrderErrorCode = (typeof ORDER_ERRORS)[keyof typeof ORDER_ERRORS]['code'];

interface PostgresError {
  code?: string;
  message?: string;
}

export function mapOrderError(error: PostgresError | null | undefined): {
  status: number;
  code: string;
  message: string;
} {
  const sqlstate = error?.code ?? '';
  const known = ORDER_ERRORS[sqlstate as keyof typeof ORDER_ERRORS];

  if (known) {
    return {
      status: known.status,
      code: known.code,
      message: error?.message ?? 'Não foi possível concluir',
    };
  }

  // Falha não prevista: o cliente recebe algo acionável, e o detalhe fica no
  // log do servidor. Nunca devolver mensagem crua do Postgres — ela carrega
  // nome de tabela e de coluna, que é reconhecimento de graça para quem sonda.
  return {
    status: 500,
    code: 'erro_interno',
    message: 'Não conseguimos enviar seu pedido. Chame alguém da equipe.',
  };
}
