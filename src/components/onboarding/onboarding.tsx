'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { COZINHAS, FUSOS } from '@/lib/onboarding/configuracoes-iniciais';
import {
  criarConta,
  criarMesas,
  criarRestaurante,
  responderConfiguracao,
} from '@/app/comecar/actions';

type Passo = 'conta' | 'restaurante' | 'configuracao' | 'mesas';

const PASSOS: { chave: Passo; rotulo: string }[] = [
  { chave: 'conta', rotulo: 'Sua conta' },
  { chave: 'restaurante', rotulo: 'O restaurante' },
  { chave: 'configuracao', rotulo: 'Como é a casa' },
];

/**
 * Onboarding (spec §14).
 *
 * Uma pergunta por vez, e cada passo faz uma escrita só. Um formulário único
 * com conta, restaurante e mesas juntos falharia inteiro por causa de um e-mail
 * repetido — e a pessoa perderia o que já tinha digitado.
 */
export function Onboarding({
  passo,
  email,
  restaurante,
}: {
  passo: Passo;
  email?: string | null;
  restaurante?: string;
}) {
  // `mesas` não tem barra própria: é o caminho de exceção, para restaurante que
  // já existia antes da configuração inicial existir e ficou sem mesa. Ocupa a terceira
  // casa em vez de devolver -1, que apagaria a barra inteira.
  const indice = passo === 'mesas' ? 2 : PASSOS.findIndex((p) => p.chave === passo);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <header className="mb-6">
        <p className="font-display text-2xl leading-tight">Pedidos.IA</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Vamos deixar o seu restaurante pronto para receber pedidos.
        </p>
      </header>

      <ol className="mb-6 flex gap-2" aria-label="Etapas">
        {PASSOS.map((p, i) => (
          <li key={p.chave} className="flex-1">
            <div
              className={cn(
                'h-1 rounded-full',
                i < indice ? 'bg-brand' : i === indice ? 'bg-foreground' : 'bg-muted',
              )}
            />
            <p
              className={cn(
                'mt-1 flex items-center gap-1 text-[11px]',
                i === indice ? 'font-bold text-foreground' : 'text-muted-foreground',
              )}
            >
              {i < indice && <CheckIcon className="size-3 text-brand" />}
              {p.rotulo}
            </p>
          </li>
        ))}
      </ol>

      {passo === 'conta' && <PassoConta />}
      {passo === 'restaurante' && <PassoRestaurante email={email} />}
      {passo === 'configuracao' && <PassoConfiguracao restaurante={restaurante ?? ''} />}
      {passo === 'mesas' && <PassoMesas restaurante={restaurante ?? ''} />}
    </main>
  );
}

function Erro({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-md bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical"
    >
      {children}
    </p>
  );
}

const CAMPO =
  'mt-1 h-12 w-full rounded-md border border-border bg-card px-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-brand';

const BOTAO =
  'h-12 w-full rounded-md bg-brand text-[15px] font-bold text-background disabled:opacity-50';

function PassoConta() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  function enviar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = await criarConta(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      if (r.confirmarEmail) {
        setConfirmar(true);
        return;
      }
      // A página relê o estado e decide o passo sozinha.
      router.refresh();
    });
  }

  if (confirmar) {
    return (
      <div className="space-y-3">
        <p className="text-[15px] font-semibold">Confirme seu e-mail</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Mandamos um link para o endereço que você digitou. Abra o link e volte
          para cá — o restaurante é o próximo passo.
        </p>
        <a
          href="/comecar"
          className="flex h-12 w-full items-center justify-center rounded-md bg-secondary text-[14px] font-semibold"
        >
          Já confirmei
        </a>
      </div>
    );
  }

  return (
    <form action={enviar} className="space-y-3">
      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">
          Seu e-mail
        </span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          className={CAMPO}
        />
      </label>

      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">Senha</span>
        <input
          name="senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={CAMPO}
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Pelo menos 8 caracteres. Uma frase que você lembra vale mais que um
          símbolo no fim.
        </span>
      </label>

      <Erro>{erro}</Erro>

      <button type="submit" disabled={pendente} className={BOTAO}>
        {pendente ? 'Criando…' : 'Criar conta'}
      </button>

      <p className="text-center text-[12px] text-muted-foreground">
        Já tem conta?{' '}
        <a href="/app/entrar" className="underline">
          Entrar
        </a>
      </p>
    </form>
  );
}

function PassoRestaurante({ email }: { email?: string | null }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function enviar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = await criarRestaurante(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      router.refresh();
    });
  }

  return (
    <form action={enviar} className="space-y-3">
      {email && (
        <p className="text-[12px] text-muted-foreground">Entrando como {email}</p>
      )}

      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">
          Nome do restaurante
        </span>
        <input name="nome" required minLength={2} maxLength={80} autoFocus className={CAMPO} />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          É o nome que o cliente vê no celular.
        </span>
      </label>

      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">Seu nome</span>
        <input name="seuNome" required minLength={2} maxLength={80} className={CAMPO} />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Aparece para a equipe e no histórico do que você fizer.
        </span>
      </label>

      <Erro>{erro}</Erro>

      <button type="submit" disabled={pendente} className={BOTAO}>
        {pendente ? 'Criando…' : 'Criar restaurante'}
      </button>
    </form>
  );
}

function PassoMesas({ restaurante }: { restaurante: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function enviar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = await criarMesas(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      // As mesas prontas levam direto para onde os códigos são impressos: sem
      // o adesivo na mesa, nada disso funciona.
      router.push('/app/gestao/mesas');
    });
  }

  return (
    <form action={enviar} className="space-y-3">
      <p className="text-[13px]">
        <strong>{restaurante}</strong> está criado. Agora as mesas.
      </p>

      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">
          Quantas mesas?
        </span>
        <input
          name="quantidade"
          type="number"
          min={1}
          max={200}
          defaultValue={10}
          required
          autoFocus
          className={cn(CAMPO, 'tabular')}
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Dá para criar mais depois. Cada mesa ganha um código próprio e
          aleatório.
        </span>
      </label>

      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">Área</span>
        <input name="area" defaultValue="Salão" maxLength={40} className={CAMPO} />
      </label>

      <Erro>{erro}</Erro>

      <button type="submit" disabled={pendente} className={BOTAO}>
        {pendente ? 'Criando…' : 'Criar mesas'}
      </button>
    </form>
  );
}

/**
 * O configuração inicial (§14, terceiro passo).
 *
 * As respostas viram categoria, produto, mesa, fuso e taxa de serviço dentro de
 * UMA transação no banco (`aplicar_configuracoes_iniciais`). O formulário não sabe montar
 * cardápio nenhum: ele coleta seis campos e entrega.
 *
 * Os produtos gerados nascem SEM PREÇO e fora do ar, e a tela diz isso antes de
 * a pessoa apertar o botão. O sistema conhece os pratos que uma pizzaria
 * costuma ter; não conhece quanto ELA cobra, e chutar seria o sistema afirmando
 * um valor sobre o negócio de outra pessoa.
 */
function PassoConfiguracao({ restaurante }: { restaurante: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  // Já vem escolhida: um formulário que exige escolher entre cinco coisas
  // parecidas antes de continuar é um formulário que perde gente. Quem tem
  // preferência troca; quem não tem, segue.
  const [tipo, setTipo] = useState<string>('hamburgueria');
  const [cashback, setCashback] = useState(false);
  const [pronto, setPronto] = useState<{
    produtos: number;
    mesas: number;
    expiraEm?: string;
    aviso?: string;
  } | null>(null);

  function enviar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = await responderConfiguracao(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      setPronto({
        produtos: r.produtosCriados ?? 0,
        mesas: r.mesasCriadas ?? 0,
        expiraEm: r.expiraEm,
        // `ok: true` COM erro é o caso em que o restaurante subiu e só a demo
        // falhou. Tratar como falha mandaria a pessoa recomeçar um cadastro
        // que já está no banco.
        aviso: r.erro,
      });
    });
  }

  if (pronto) return <ConfiguracaoPronta {...pronto} router={router} />;

  return (
    <form action={enviar} className="space-y-3">
      <p className="text-[13px]">
        <strong>{restaurante}</strong> está criado. Faltam três coisas rápidas —
        o cardápio você monta depois, com calma, e do seu jeito.
      </p>

      {/*
        A ESCOLHA DO TIPO SÓ EXISTE PARA A DEMONSTRAÇÃO.

        Antes ela era a primeira pergunta e gerava o cardápio da casa: escolhia
        "hamburgueria" e ganhava dez pratos que a pessoa não vende, a R$ 0,00 e
        fora do ar. O primeiro trabalho dela com o produto era apagar.

        O campo continua sendo enviado quando a caixa está desmarcada — a
        Server Action exige um valor — mas aí ele não é usado para nada. Fica
        escondido em vez de ausente porque um `select` que aparece e some
        embaixo do dedo é pior do que um que não aparece.
      */}
      {!demo && <input type="hidden" name="tipoCozinha" value="hamburgueria" />}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Quantas mesas?
          </span>
          <input
            name="mesas"
            type="number"
            min={1}
            max={200}
            defaultValue={10}
            required
            className={cn(CAMPO, 'tabular')}
          />
        </label>

        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Taxa de serviço
          </span>
          <div className="relative">
            <input
              name="taxaServico"
              type="number"
              min={0}
              max={30}
              step={0.5}
              defaultValue={10}
              required
              className={cn(CAMPO, 'tabular pr-8')}
            />
            <span className="pointer-events-none absolute right-3 bottom-3.5 text-[13px] text-muted-foreground">
              %
            </span>
          </div>
        </label>
      </div>

      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">Cidade</span>
        <input name="cidade" maxLength={80} className={CAMPO} />
      </label>

      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">Fuso horário</span>
        <select name="timezone" defaultValue="America/Sao_Paulo" className={CAMPO}>
          {FUSOS.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.rotulo}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-muted-foreground">
          É o que decide em que dia cai cada fechamento de caixa.
        </span>
      </label>

      {/*
        CASHBACK: ligado ou desligado, explicitamente.

        A primeira versão era só um campo numérico com zero por padrão — e "0"
        numa caixa de número não comunica "desligado", comunica "ainda não
        digitei". Quem passou pelo cadastro não percebeu que a pergunta existia.
        Agora a decisão é uma caixa, e o percentual só aparece depois dela.
      */}
      <div
        className={cn(
          'rounded-md border px-3 py-3 transition-colors',
          cashback ? 'border-brand bg-brand/5' : 'border-border bg-card',
        )}
      >
        <label className="flex items-start gap-3">
          <input
            name="cashbackLigado"
            type="checkbox"
            checked={cashback}
            onChange={(e) => setCashback(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span className="text-[13px] font-semibold leading-snug">
            Dar cashback a clientes cadastrados
            <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
              Quem se cadastrar com CPF ganha uma fatia do que consumiu, liberada
              em 24 h. Dá para ligar depois, em Gestão → Configurações.
            </span>
          </span>
        </label>

        {cashback && (
          <div className="mt-3 border-t border-border pt-3">
            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">
                Quanto volta para o cliente
              </span>
              <div className="relative">
                <input
                  name="cashback"
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.5}
                  defaultValue={5}
                  className={cn(CAMPO, 'tabular pr-8')}
                />
                <span className="pointer-events-none absolute right-3 bottom-3.5 text-[13px] text-muted-foreground">
                  %
                </span>
              </div>
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                Incide sobre os itens, sem a taxa de serviço. No resgate, o
                abatimento vai até 30% da conta.
              </span>
            </label>
          </div>
        )}
      </div>

      <label className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-3">
        <input
          name="pedirTelefone"
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--color-brand)]"
        />
        <span className="text-[13px] leading-snug">
          Pedir o telefone do cliente ao abrir a mesa
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Fica mascarado nas telas da equipe; revelar é registrado na
            auditoria.
          </span>
        </span>
      </label>

      <label
        className={cn(
          'flex items-start gap-3 rounded-md border px-3 py-3 transition-colors',
          demo ? 'border-brand bg-brand/5' : 'border-border bg-card',
        )}
      >
        <input
          name="gerarDemo"
          type="checkbox"
          checked={demo}
          onChange={(e) => setDemo(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--color-brand)]"
        />
        <span className="text-[13px] leading-snug">
          Quero ver uma demonstração pronta
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Um restaurante fictício com cardápio, preços e uma noite de serviço
            acontecendo: mesa ocupada, pedido esperando aprovação, prato na
            passagem. Para ver o sistema cheio em vez de vazio.
          </span>
        </span>
      </label>

      {demo && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-[12px] font-semibold text-muted-foreground">
            Qual casa você quer ver?
          </p>
          <div className="mt-2 space-y-1.5">
            {COZINHAS.map((c) => (
              <label
                key={c.valor}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5',
                  tipo === c.valor ? 'border-brand bg-brand/5' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="tipoCozinha"
                  value={c.valor}
                  checked={tipo === c.valor}
                  onChange={() => setTipo(c.valor)}
                  className="mt-0.5 size-4 accent-[var(--color-brand)]"
                />
                <span className="text-[13px] leading-snug">
                  {c.rotulo}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {c.descricao}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            São cinco negócios que aparecem diferente na tela — uma balada não
            tem entrada, uma açaiteria vive de adicional, uma pizzaria vende um
            item que duas pessoas dividem.
          </p>
        </div>
      )}

      {/*
        O aviso aparece só quando a caixa está marcada, e antes do botão. É
        destrutivo de verdade — não é um "modo demo" que se desliga depois — e
        precisa ser exato sobre o que some e o que fica: some o restaurante,
        fica o login. Dizer que a conta some seria assustar à toa; omitir que o
        restaurante some seria a mentira oposta.
      */}
      {demo && (
        <p className="rounded-md bg-alert-critical/10 px-3 py-2 text-[12px] leading-snug text-alert-critical">
          <strong>Isto expira em 3 horas.</strong> O restaurante, o cardápio e
          os pedidos são apagados, e não dá para recuperar.{' '}
          <strong>Seu login continua valendo</strong> — depois você monta o
          restaurante de verdade com a mesma conta. Para uma casa que já vai
          entrar em operação, deixe desmarcado.
        </p>
      )}

      <Erro>{erro}</Erro>

      <button type="submit" disabled={pendente} className={BOTAO}>
        {pendente ? 'Montando…' : demo ? 'Gerar demonstração' : 'Montar meu sistema'}
      </button>
    </form>
  );
}

function ConfiguracaoPronta({
  produtos,
  mesas,
  expiraEm,
  aviso,
  router,
}: {
  produtos: number;
  mesas: number;
  expiraEm?: string;
  aviso?: string;
  router: ReturnType<typeof useRouter>;
}) {
  const hora = expiraEm
    ? new Date(expiraEm).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })
    : null;

  return (
    <div className="space-y-3">
      <p className="text-[15px] font-semibold">Pronto.</p>

      {/*
        A LISTA MUDA CONFORME O CAMINHO, e a diferença é o assunto.

        Numa demonstração há cardápio para contar. Num restaurante de verdade
        não há — ele nasce vazio de propósito (0059) — e dizer "0 itens no
        cardápio" soaria como falha, quando é a decisão.
      */}
      <ul className="space-y-1 text-[13px] text-muted-foreground">
        {hora ? (
          <li>
            <strong className="tabular text-foreground">{produtos}</strong> itens
            no cardápio, com preço
          </li>
        ) : (
          <li>
            Cardápio <strong className="text-foreground">em branco</strong> — o
            que a casa vende é você que sabe
          </li>
        )}
        <li>
          <strong className="tabular text-foreground">{mesas}</strong> mesas
          novas, cada uma com o código próprio
        </li>
      </ul>

      {aviso && <Erro>{aviso}</Erro>}

      {hora ? (
        <>
          <p className="rounded-md bg-alert-critical/10 px-3 py-2 text-[12px] leading-snug text-alert-critical">
            A demonstração some às <strong className="tabular">{hora}</strong>.
            Seu login continua — é só voltar em <span className="font-mono">/comecar</span>{' '}
            para montar o restaurante de verdade.
          </p>
          <button
            onClick={() => router.push('/app/salao')}
            className="h-12 w-full rounded-md bg-brand text-[15px] font-bold text-background"
          >
            Ver o salão em movimento
          </button>
          <p className="text-center text-[12px] text-muted-foreground">
            Comece pelo salão: é lá que a mesa esperando aprovação aparece.
          </p>
        </>
      ) : (
        <>
          <p className="rounded-md bg-secondary px-3 py-2 text-[12px] leading-snug">
            O sistema <strong>não inventa o seu cardápio</strong>: ele não sabe o
            que a sua casa vende, e um cardápio chutado só daria trabalho de
            apagar. A tela de <strong>Começar</strong> mostra o que falta e leva
            você a cada lugar.
          </p>
          <button
            onClick={() => router.push('/app/gestao/inicio')}
            className="h-12 w-full rounded-md bg-brand text-[15px] font-bold text-background"
          >
            Ver o que falta
          </button>
          <button
            onClick={() => router.push('/app/gestao/mesas')}
            className="h-12 w-full rounded-md bg-secondary text-[14px] font-semibold"
          >
            Imprimir os códigos das mesas
          </button>
        </>
      )}
    </div>
  );
}
