'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon, WalletIcon } from 'lucide-react';

import { formatCents } from '@/lib/money';
import {
  criarConta,
  devolverSaldo,
  entrarNaConta,
  sairDaConta,
  usarSaldo,
} from '@/app/m/[short_code]/conta/actions';

interface Lancamento {
  id: string;
  tipo: 'credito' | 'resgate';
  valorCents: number;
  liberaEm: string;
  baseCents: number | null;
  pct: number | null;
  quando: string;
}

/**
 * "Minha conta" no celular do cliente (spec §4, §11).
 *
 * Duas telas no mesmo lugar, decididas pelo servidor: sem conta, é
 * cadastro/entrada; com conta, é saldo e extrato.
 *
 * NENHUM valor é calculado aqui. O saldo, a carência e o quanto cabe nesta
 * conta vêm prontos do banco — este arquivo formata e mostra. É a mesma regra
 * que impede o preço de vir do navegador (§10.1), aplicada ao dinheiro que o
 * cliente já tem.
 */
export function ContaDoCliente({
  shortCode,
  restaurante,
  corDaMarca,
  cashbackPct,
  nome,
  saldoCents = 0,
  carenciaCents = 0,
  extrato = [],
  extratoIndisponivel = false,
  conta = null,
}: {
  shortCode: string;
  restaurante: string;
  corDaMarca: string;
  cashbackPct: number;
  nome?: string;
  saldoCents?: number;
  carenciaCents?: number;
  extrato?: Lancamento[];
  /** A consulta falhou — diferente de não haver lançamento nenhum. */
  extratoIndisponivel?: boolean;
  conta?: { totalCents: number; cashbackCents: number; tetoCents: number } | null;
}) {
  const logado = Boolean(nome);

  return (
    <div
      className="mx-auto min-h-dvh max-w-lg px-4 pb-16 pt-5"
      style={{ '--brand': corDaMarca } as React.CSSProperties}
    >
      <Link
        href={`/m/${shortCode}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Voltar ao cardápio
      </Link>

      <h1 className="font-display mt-3 text-[26px] leading-tight">Minha conta</h1>
      <p className="text-[13px] text-muted-foreground">{restaurante}</p>

      {logado ? (
        <Logado
          shortCode={shortCode}
          nome={nome!}
          cashbackPct={cashbackPct}
          saldoCents={saldoCents}
          carenciaCents={carenciaCents}
          extrato={extrato}
          extratoIndisponivel={extratoIndisponivel}
          conta={conta}
        />
      ) : (
        <SemConta shortCode={shortCode} cashbackPct={cashbackPct} />
      )}
    </div>
  );
}

const CAMPO =
  'mt-1 h-12 w-full rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

function Erro({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
      {children}
    </p>
  );
}

function SemConta({ shortCode, cashbackPct }: { shortCode: string; cashbackPct: number }) {
  const router = useRouter();
  const [aba, setAba] = useState<'entrar' | 'criar'>('entrar');
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function enviar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = aba === 'criar'
        ? await criarConta(shortCode, formData)
        : await entrarNaConta(shortCode, formData);
      if (!r.ok) setErro(r.erro ?? 'Não deu certo');
      else router.refresh();
    });
  }

  return (
    <>
      {/*
        O VISITANTE CONTINUA SENDO O PADRÃO, e a tela diz isso primeiro. Quem
        entrou aqui por curiosidade precisa saber que não é obrigado a nada —
        pedir comida nunca exigiu conta neste sistema e continua não exigindo.
      */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        {cashbackPct > 0 ? (
          <>
            <p className="text-[15px] font-semibold">
              Ganhe {formatPct(cashbackPct)} de volta
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              A cada conta fechada, {formatPct(cashbackPct)} do que você consumiu
              vira saldo aqui. Libera em <strong>24 horas</strong> e vale nas
              próximas visitas.
            </p>
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Sua conta guarda seus pedidos anteriores nesta casa.
          </p>
        )}
        <p className="mt-2 text-[12px] text-muted-foreground">
          Não quer conta? Tudo bem — dá para pedir normalmente como visitante,
          só com o nome.
        </p>
      </div>

      <div className="mt-5 flex gap-2">
        {(['entrar', 'criar'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => { setAba(a); setErro(null); }}
            className={`h-10 flex-1 rounded-lg text-[14px] font-semibold ${
              aba === a ? 'bg-brand text-background' : 'bg-secondary'
            }`}
          >
            {a === 'entrar' ? 'Já tenho conta' : 'Criar conta'}
          </button>
        ))}
      </div>

      <form action={enviar} className="mt-4">
        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">CPF</span>
          <input
            name="cpf"
            inputMode="numeric"
            autoComplete="off"
            required
            placeholder="000.000.000-00"
            className={CAMPO}
          />
        </label>

        {aba === 'criar' && (
          <>
            <label className="mt-3 block">
              <span className="text-[12px] font-semibold text-muted-foreground">Seu nome</span>
              <input name="nome" required minLength={2} maxLength={80} className={CAMPO} />
            </label>
            <label className="mt-3 block">
              <span className="text-[12px] font-semibold text-muted-foreground">
                Celular <span className="font-normal">(opcional)</span>
              </span>
              <input name="telefone" inputMode="tel" className={CAMPO} />
            </label>
            <label className="mt-3 block">
              <span className="text-[12px] font-semibold text-muted-foreground">
                E-mail <span className="font-normal">(opcional)</span>
              </span>
              <input name="email" type="email" className={CAMPO} />
            </label>
          </>
        )}

        <label className="mt-3 block">
          <span className="text-[12px] font-semibold text-muted-foreground">Senha</span>
          <input
            name="senha"
            type="password"
            required
            minLength={8}
            autoComplete={aba === 'criar' ? 'new-password' : 'current-password'}
            className={CAMPO}
          />
          {aba === 'criar' && (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Pelo menos 8 caracteres. Guarde bem: como não pedimos confirmação
              de e-mail, ainda não há como recuperá-la sozinho.
            </span>
          )}
        </label>

        <Erro>{erro}</Erro>

        <button
          type="submit"
          disabled={pendente}
          className="mt-4 h-12 w-full rounded-lg bg-brand text-[15px] font-bold text-background disabled:opacity-50"
        >
          {pendente ? 'Um momento…' : aba === 'criar' ? 'Criar minha conta' : 'Entrar'}
        </button>
      </form>
    </>
  );
}

function Logado({
  shortCode,
  nome,
  cashbackPct,
  saldoCents,
  carenciaCents,
  extrato,
  extratoIndisponivel,
  conta,
}: {
  shortCode: string;
  nome: string;
  cashbackPct: number;
  saldoCents: number;
  carenciaCents: number;
  extrato: Lancamento[];
  extratoIndisponivel: boolean;
  conta: { totalCents: number; cashbackCents: number; tetoCents: number } | null;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function acao(fn: () => Promise<{ ok: boolean; erro?: string }>) {
    setErro(null);
    iniciar(async () => {
      const r = await fn();
      if (!r.ok) setErro(r.erro ?? 'Não deu certo');
      else router.refresh();
    });
  }

  const jaAplicado = (conta?.cashbackCents ?? 0) > 0;

  return (
    <>
      <div className="mt-4 rounded-xl border-2 border-brand bg-card p-4">
        <p className="text-[12px] uppercase tracking-wider text-muted-foreground">
          Saldo disponível
        </p>
        <p className="font-display mt-0.5 text-4xl tabular">{formatCents(saldoCents)}</p>

        {carenciaCents > 0 && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            + <strong className="tabular">{formatCents(carenciaCents)}</strong>{' '}
            liberando nas próximas 24 horas
          </p>
        )}
      </div>

      {/* O RESGATE, e o teto explicado em vez de escondido. */}
      {conta && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="text-[13px] font-semibold">Nesta mesa</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Conta atual: <strong className="tabular">{formatCents(conta.totalCents)}</strong>
          </p>

          {jaAplicado ? (
            <>
              <p className="mt-2 rounded-lg bg-brand/10 px-3 py-2 text-[13px]">
                <strong className="tabular">{formatCents(conta.cashbackCents)}</strong> do
                seu saldo já está abatido nesta conta.
              </p>
              <button
                type="button"
                onClick={() => acao(() => devolverSaldo(shortCode))}
                disabled={pendente}
                className="mt-2 h-10 w-full rounded-lg bg-secondary text-[13px] font-semibold disabled:opacity-50"
              >
                Não quero usar agora
              </button>
            </>
          ) : conta.tetoCents > 0 ? (
            <>
              <button
                type="button"
                onClick={() => acao(() => usarSaldo(shortCode))}
                disabled={pendente}
                className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand text-[15px] font-bold text-background disabled:opacity-50"
              >
                <WalletIcon className="size-4" />
                {pendente ? 'Aplicando…' : `Usar ${formatCents(conta.tetoCents)}`}
              </button>
              {conta.tetoCents < saldoCents && (
                // Sem esta linha, o cliente com R$ 50 numa conta de R$ 60 vê um
                // botão oferecendo R$ 18 e conclui que o sistema comeu o resto.
                <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
                  O abatimento vai até <strong>30% da conta</strong>. O resto do
                  seu saldo continua guardado para a próxima.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {saldoCents > 0
                ? 'Esta conta ainda é pequena para usar o saldo — o abatimento vai até 30% dela.'
                : 'Você ainda não tem saldo para usar aqui.'}
            </p>
          )}
        </div>
      )}

      <Erro>{erro}</Erro>

      <h2 className="mt-6 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        Extrato
      </h2>
      {extratoIndisponivel ? (
        // Nunca dizer "não há lançamentos" quando a verdade é "não consegui
        // ler". O saldo acima veio de outra via e continua correto; o que
        // falhou foi a lista.
        <p className="mt-2 text-[13px] text-muted-foreground">
          Não deu para carregar o extrato agora. Seu saldo acima está correto.
        </p>
      ) : extrato.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Nada por aqui ainda. {cashbackPct > 0 &&
            `Feche uma conta e ${formatPct(cashbackPct)} dela volta para você.`}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {extrato.map((l) => (
            <li key={l.id} className="flex items-baseline justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[14px]">
                  {l.tipo === 'credito' ? 'Cashback' : 'Usado na conta'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(l.quando).toLocaleDateString('pt-BR', {
                    day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo',
                  })}
                  {l.tipo === 'credito' && new Date(l.liberaEm) > new Date() && (
                    <> · libera{' '}
                      {new Date(l.liberaEm).toLocaleString('pt-BR', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                        timeZone: 'America/Sao_Paulo',
                      })}
                    </>
                  )}
                  {l.tipo === 'credito' && l.pct != null && l.baseCents != null && (
                    <> · {formatPct(Number(l.pct))} de {formatCents(l.baseCents)}</>
                  )}
                </p>
              </div>
              <p
                className={`shrink-0 tabular text-[15px] font-semibold ${
                  l.tipo === 'credito' ? 'text-brand' : 'text-muted-foreground'
                }`}
              >
                {l.tipo === 'credito' ? '+' : '−'}
                {formatCents(l.valorCents)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-[12px] text-muted-foreground">Entrou como {nome}</p>
        <button
          type="button"
          onClick={() => acao(() => sairDaConta(shortCode))}
          disabled={pendente}
          className="text-[12px] underline disabled:opacity-50"
        >
          Sair
        </button>
      </div>
    </>
  );
}

/** "10%" e não "10,00%" — percentual inteiro é o caso normal. */
function formatPct(v: number): string {
  return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}
