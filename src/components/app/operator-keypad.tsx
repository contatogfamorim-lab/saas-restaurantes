'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DeleteIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { entrarOperador } from '@/app/app/operador/actions';

/**
 * Teclado do operador.
 *
 * Dois campos, os dois numéricos, num teclado desenhado na tela — não o do
 * sistema. Motivo prático: no tablet da cozinha e no celular no meio do salão,
 * o teclado nativo cobre metade da tela, abre e fecha a cada foco e é operado
 * com a mão engordurada. Botão de 72px não erra.
 *
 * O código é o do crachá; os 5 dígitos são o segredo. A senha nunca aparece —
 * quem digita está de costas para o salão, mas o salão está de frente para ele.
 */
export function OperatorKeypad({ nomeDoRestaurante }: { nomeDoRestaurante: string }) {
  const router = useRouter();
  const [campo, setCampo] = useState<'codigo' | 'senha'>('codigo');
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const limite = campo === 'codigo' ? 6 : 5;

  function digitar(d: string) {
    setErro(null);
    if (campo === 'codigo') {
      if (codigo.length >= limite) return;
      const proximo = codigo + d;
      setCodigo(proximo);
      // dois dígitos é o formato mais comum de código; passa o foco sozinho
      if (proximo.length === 2) setCampo('senha');
      return;
    }

    if (senha.length >= 5) return;
    const proxima = senha + d;
    setSenha(proxima);
    if (proxima.length === 5) enviar(codigo, proxima);
  }

  function apagar() {
    setErro(null);
    if (campo === 'senha') {
      if (senha.length > 0) return setSenha((s) => s.slice(0, -1));
      return setCampo('codigo');
    }
    setCodigo((c) => c.slice(0, -1));
  }

  function enviar(c: string, s: string) {
    iniciar(async () => {
      const r = await entrarOperador(c, s);

      if (r.ok) {
        router.replace('/app');
        router.refresh();
        return;
      }

      setSenha('');
      setCampo('senha');

      if (r.falha === 'bloqueado') {
        setErro(
          `Bloqueado por ${r.minutosRestantes ?? 15} min. Chame quem administra.`,
        );
      } else if (r.falha === 'aparelho_nao_liberado') {
        setErro('Este aparelho não está liberado.');
      } else if (r.falha === 'erro_interno') {
        setErro('Falha no sistema. Tente de novo.');
      } else {
        // Mensagem única para código inexistente e senha errada: dizer qual dos
        // dois está errado entregaria a lista de códigos da casa.
        setErro('Código ou senha incorretos.');
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-6">
      <p className="text-center text-[13px] uppercase tracking-wider text-muted-foreground">
        {nomeDoRestaurante}
      </p>

      <div className="mt-5 flex items-stretch gap-2">
        <Campo
          rotulo="Código"
          valor={codigo}
          ativo={campo === 'codigo'}
          onFocar={() => setCampo('codigo')}
        />
        <Campo
          rotulo="Senha"
          valor={senha}
          mascarado
          ativo={campo === 'senha'}
          onFocar={() => setCampo('senha')}
        />
      </div>

      <p
        role={erro ? 'alert' : undefined}
        className={cn(
          'mt-3 min-h-[20px] text-center text-[13px]',
          erro ? 'font-semibold text-destructive' : 'text-muted-foreground',
        )}
      >
        {erro ?? (pendente ? 'Entrando…' : 'Digite seu código e a senha de 5 dígitos')}
      </p>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Tecla key={d} onClick={() => digitar(d)} disabled={pendente}>
            {d}
          </Tecla>
        ))}

        <Tecla onClick={() => setCampo(campo === 'codigo' ? 'senha' : 'codigo')} disabled={pendente}>
          <span className="text-[13px] font-semibold uppercase">
            {campo === 'codigo' ? 'senha' : 'código'}
          </span>
        </Tecla>

        <Tecla onClick={() => digitar('0')} disabled={pendente}>
          0
        </Tecla>

        <Tecla onClick={apagar} disabled={pendente} aria-label="Apagar">
          <DeleteIcon className="size-6" />
        </Tecla>
      </div>

      <a
        href="/app/entrar?admin=1"
        className="mt-6 text-center text-[13px] text-muted-foreground underline underline-offset-4"
      >
        Entrar como Administrador
      </a>
    </main>
  );
}

function Campo({
  rotulo,
  valor,
  ativo,
  mascarado = false,
  onFocar,
}: {
  rotulo: string;
  valor: string;
  ativo: boolean;
  mascarado?: boolean;
  onFocar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFocar}
      className={cn(
        'flex-1 rounded-lg border-2 px-3 py-2 text-left',
        ativo ? 'border-foreground' : 'border-input',
      )}
    >
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      <span className="tabular block h-8 text-2xl font-bold leading-8">
        {mascarado ? '•'.repeat(valor.length) : valor}
        {ativo && <span className="ml-0.5 opacity-40">_</span>}
      </span>
    </button>
  );
}

function Tecla({
  children,
  onClick,
  disabled,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // 72px: mão engordurada, luva, tablet fixo na parede (spec §6)
      className="flex h-[72px] items-center justify-center rounded-lg bg-muted text-3xl font-semibold active:bg-accent disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}
