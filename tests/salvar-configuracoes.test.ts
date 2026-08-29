/**
 * O FORMULÁRIO DE CONFIGURAÇÕES NÃO PODE DESCONECTAR O WHATSAPP.
 *
 * A tela trocou o campo de texto "nome da instância" por um painel de conexão,
 * e o painel não faz parte do `<form>`. O formulário parou de mandar
 * `whatsapp` — e a linha que lê esse campo estava escrita `?? ''`, que numa
 * função onde string vazia SIGNIFICA DESCONECTAR transformaria "salvar a cor da
 * marca" em "derrubar as campanhas da casa".
 *
 * O defeito seria silencioso dos dois lados: o WhatsApp continuaria pareado no
 * celular do dono, e o sistema simplesmente pararia de mandar mensagem.
 *
 * O teste de banco (`tests/db/cashback.test.ts`) prova que a FUNÇÃO trata
 * ausência como preservação. Este prova que a AÇÃO de fato omite a chave —
 * são duas coisas diferentes, e a segunda é a que eu mexi.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A assinatura vai no genérico, e não em parâmetros que ninguém usa: sem ela o
// TypeScript infere a tupla vazia para `mock.calls` e `calls.at(-1)![1]` nem
// compila.
const rpc = vi.fn<
  (funcao: string, args: { p_valores: Record<string, unknown> }) => Promise<{ error: null }>
>(async () => ({ error: null }));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/staff', () => ({
  exigirPermissao: async () => ({ restaurantId: 'r1' }),
  exigirStaff: async () => ({ restaurantId: 'r1' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));

const { salvarConfiguracoes } = await import(
  '@/app/app/(gestao)/gestao/configuracoes/actions'
);

/** O formulário como a tela o manda hoje: sem `whatsapp`. */
function formulario(extra?: Record<string, string>): FormData {
  const f = new FormData();
  f.set('nome', 'Brasa Burger');
  f.set('taxaServico', '10');
  f.set('timezone', 'America/Sao_Paulo');
  f.set('pedirTelefone', 'on');
  f.set('cor', '#D97A28');
  f.set('tetoDiario', '200');
  f.set('carencia', '24');
  for (const [k, v] of Object.entries(extra ?? {})) f.set(k, v);
  return f;
}

function valoresEnviados(): Record<string, unknown> {
  const ultima = rpc.mock.calls.at(-1);
  if (!ultima) throw new Error('a ação não chamou o banco');
  return ultima[1].p_valores;
}

beforeEach(() => rpc.mockClear());

describe('a chave `whatsapp` no que vai para o banco', () => {
  it('campo AUSENTE não vira chave nenhuma', async () => {
    const r = await salvarConfiguracoes(formulario());

    expect(r.ok).toBe(true);
    // `toHaveProperty` seria falso-negativo aqui: `{whatsapp: undefined}` tem a
    // propriedade, e o `JSON.stringify` do driver a remove. O que importa é a
    // chave não existir no objeto que sai daqui.
    expect(Object.keys(valoresEnviados())).not.toContain('whatsapp');
  });

  it('o resto do formulário continua indo inteiro', async () => {
    // Sem isto, uma implementação que não mandasse NADA passaria no teste acima.
    await salvarConfiguracoes(formulario());
    const v = valoresEnviados();
    expect(v.nome).toBe('Brasa Burger');
    expect(v.taxa_servico).toBe(10);
    expect(v.cor).toBe('#D97A28');
  });

  it('campo VAZIO ainda desconecta — é o botão "Desligar"', async () => {
    await salvarConfiguracoes(formulario({ whatsapp: '' }));
    expect(valoresEnviados().whatsapp).toBe('');
  });

  it('nome válido passa como está', async () => {
    await salvarConfiguracoes(formulario({ whatsapp: 'brasa_burger_3f8b2c1d' }));
    expect(valoresEnviados().whatsapp).toBe('brasa_burger_3f8b2c1d');
  });
});
