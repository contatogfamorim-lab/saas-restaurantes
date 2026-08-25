'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { criarConta, criarMesas, criarRestaurante } from '@/app/comecar/actions';

type Passo = 'conta' | 'restaurante' | 'mesas';

const PASSOS: { chave: Passo; rotulo: string }[] = [
  { chave: 'conta', rotulo: 'Sua conta' },
  { chave: 'restaurante', rotulo: 'O restaurante' },
  { chave: 'mesas', rotulo: 'As mesas' },
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
  const indice = PASSOS.findIndex((p) => p.chave === passo);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <header className="mb-6">
        <p className="font-display text-2xl leading-tight">Markello</p>
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
