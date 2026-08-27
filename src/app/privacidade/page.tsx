import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Como usamos seus dados',
  robots: { index: false, follow: false },
};

/**
 * Aviso de tratamento de dados, ligado ao consentimento LGPD do cardápio.
 *
 * É uma descrição FACTUAL do que o sistema coleta, por quê, por quanto tempo e
 * como apagar — escrita a partir do que o código realmente faz. Não é a
 * política de privacidade jurídica do restaurante: essa depende do contrato
 * entre a Pedidos.IA (operadora) e cada casa (controladora), e precisa de revisão
 * de advogado antes de ir ao ar com clientes reais.
 */
export default function Privacidade() {
  return (
    <main className="mx-auto max-w-prose px-5 py-10">
      <h1 className="font-display text-3xl leading-tight">Como usamos seus dados</h1>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Este cardápio é operado pela Pedidos.IA para o restaurante onde você está.
        O texto abaixo descreve o que o sistema faz hoje, na prática.
      </p>

      <Secao titulo="O que pedimos">
        <p>
          <strong>Seu nome</strong> — obrigatório, e só no momento de enviar o
          primeiro pedido. É o que permite ao garçom saber de quem é cada prato
          e ao caixa dividir a conta.
        </p>
        <p>
          <strong>Seu telefone</strong> — opcional na maioria das casas. Só é
          guardado se você marcar a autorização; sem a marcação, ele é
          descartado no servidor e não chega ao banco de dados.
        </p>
        <p>
          Não pedimos CPF, e-mail, data de nascimento nem endereço. Não há
          cadastro e não há senha.
        </p>
      </Secao>

      <Secao titulo="O que o aparelho guarda">
        <p>
          Um identificador aleatório que nós mesmos geramos, para reconhecer que
          é você quando pedir de novo na mesma mesa — assim não perguntamos seu
          nome a cada rodada. Ele não identifica você fora deste restaurante e
          some quando você limpa os dados do navegador.
        </p>
        <p>
          Também guardamos seu carrinho no próprio aparelho, para que fechar a
          aba sem querer não apague o pedido que você estava montando.
        </p>
      </Secao>

      <Secao titulo="O que registramos do uso">
        <p>
          Quais pratos foram abertos e adicionados ao carrinho, sem ligação com
          seu nome. Serve para o restaurante entender o que chama atenção no
          cardápio e o que não vende.
        </p>
      </Secao>

      <Secao titulo="Quem vê">
        <p>
          A equipe do restaurante onde você está, e ninguém mais. Nenhum outro
          restaurante da plataforma tem acesso aos dados desta casa. Seu
          telefone aparece mascarado (•••••-1234) para a maior parte da equipe;
          o número completo é visível apenas para gerência e proprietário, e
          esse acesso fica registrado.
        </p>
      </Secao>

      <Secao titulo="Por quanto tempo">
        <p>
          A comanda e os pedidos ficam guardados como registro fiscal e
          contábil do restaurante. O telefone é expurgado depois de um período
          sem retorno, definido por cada casa.
        </p>
      </Secao>

      <Secao titulo="Como apagar">
        <p>
          Peça a qualquer pessoa da equipe, ou fale com o restaurante depois. A
          exclusão do telefone é feita sem prejuízo do seu pedido.
        </p>
      </Secao>

      <p className="mt-10 border-t pt-5 text-[13px] leading-relaxed text-muted-foreground">
        Este aviso descreve o funcionamento técnico do sistema. A política de
        privacidade formal do restaurante, com as bases legais e os dados do
        controlador, é responsabilidade da casa.
      </p>
    </main>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg">{titulo}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
