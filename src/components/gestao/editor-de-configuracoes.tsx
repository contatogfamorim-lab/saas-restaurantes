'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { FUSOS } from '@/lib/onboarding/briefing';
import { salvarConfiguracoes } from '@/app/app/(gestao)/gestao/configuracoes/actions';

/**
 * Configurações da casa (§8).
 *
 * As mesmas perguntas do briefing, agora editáveis para sempre. Os campos são
 * controlados porque o botão de salvar precisa saber se algo mudou — um botão
 * sempre aceso convida a salvar sem querer, num formulário que mexe em taxa e
 * cashback.
 *
 * Nada aqui é proteção: `atualizar_configuracoes` cobra o papel `owner` dentro
 * do banco, reaperta os tetos e registra a mudança no `audit_log` (§10.3).
 */
export function EditorDeConfiguracoes({
  nome: nomeInicial,
  taxaServico: taxaInicial,
  cashback: cashbackInicial,
  timezone: fusoInicial,
  pedirTelefone: telefoneInicial,
  cor: corInicial,
}: {
  nome: string;
  taxaServico: number;
  cashback: number;
  timezone: string;
  pedirTelefone: boolean;
  cor: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const [nome, setNome] = useState(nomeInicial);
  const [taxa, setTaxa] = useState(String(taxaInicial));
  const [fuso, setFuso] = useState(fusoInicial);
  const [telefone, setTelefone] = useState(telefoneInicial);
  const [cor, setCor] = useState(corInicial);

  // O CASHBACK É DOIS ESTADOS, e não um número.
  //
  // Antes era só um campo com zero por padrão, e "0" numa caixa de número não
  // diz "desligado" — diz "ainda não digitei". Ligado/desligado explícito, e o
  // percentual só aparece quando faz sentido responder.
  const [cashbackLigado, setCashbackLigado] = useState(cashbackInicial > 0);
  const [cashback, setCashback] = useState(String(cashbackInicial || 5));

  const cashbackEfetivo = cashbackLigado ? Number(cashback) : 0;

  const sujo =
    nome !== nomeInicial ||
    Number(taxa) !== taxaInicial ||
    cashbackEfetivo !== cashbackInicial ||
    fuso !== fusoInicial ||
    telefone !== telefoneInicial ||
    cor !== corInicial;

  function enviar(formData: FormData) {
    setErro(null);
    setSalvo(false);
    iniciar(async () => {
      const r = await salvarConfiguracoes(formData);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      setSalvo(true);
      router.refresh();
    });
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-6">
      <h1 className="font-display text-2xl leading-tight">Configurações</h1>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        O que o cadastro perguntou uma vez. Toda alteração aqui vai para a
        auditoria, com o antes e o depois.
      </p>

      <form action={enviar} className="mt-6 space-y-5">
        <Bloco titulo="A casa">
          <label className="block">
            <Rotulo>Nome do restaurante</Rotulo>
            <input
              name="nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              className={CAMPO}
            />
            <Ajuda>É o nome que o cliente vê no celular e no topo das telas.</Ajuda>
          </label>

          <label className="mt-4 block">
            <Rotulo>Cor da marca</Rotulo>
            <div className="mt-1 flex items-center gap-3">
              <input
                name="cor"
                type="color"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
                className="size-11 shrink-0 cursor-pointer rounded-md border border-border bg-card"
              />
              <span className="tabular text-[13px] text-muted-foreground">{cor}</span>
            </div>
          </label>

          <label className="mt-4 block">
            <Rotulo>Fuso horário</Rotulo>
            <select
              name="timezone"
              value={fuso}
              onChange={(e) => setFuso(e.target.value)}
              className={CAMPO}
            >
              {FUSOS.map((f) => (
                <option key={f.valor} value={f.valor}>{f.rotulo}</option>
              ))}
              {/* Um fuso fora da lista (vindo de dado antigo) precisa continuar
                  selecionável, senão salvar aqui o trocaria em silêncio. */}
              {!FUSOS.some((f) => f.valor === fuso) && (
                <option value={fuso}>{fuso}</option>
              )}
            </select>
            <Ajuda>Decide em que dia cai cada fechamento de caixa.</Ajuda>
          </label>
        </Bloco>

        <Bloco titulo="Dinheiro">
          <label className="block">
            <Rotulo>Taxa de serviço</Rotulo>
            <div className="relative">
              <input
                name="taxaServico"
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
                required
                className={cn(CAMPO, 'tabular pr-8')}
              />
              <Percento />
            </div>
            <Ajuda>
              Entra em toda conta aberta a partir de agora. Comandas já abertas
              recalculam sozinhas.
            </Ajuda>
          </label>

          {/* ---- CASHBACK: ligado ou desligado, explicitamente ---- */}
          <div
            className={cn(
              'mt-4 rounded-lg border p-3 transition-colors',
              cashbackLigado ? 'border-brand bg-brand/5' : 'border-border bg-card',
            )}
          >
            <label className="flex items-start gap-3">
              <input
                name="cashbackLigado"
                type="checkbox"
                checked={cashbackLigado}
                onChange={(e) => setCashbackLigado(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-brand)]"
              />
              <span className="text-[14px] font-semibold leading-snug">
                Dar cashback a clientes cadastrados
                <span className="mt-0.5 block text-[12px] font-normal text-muted-foreground">
                  Quem se cadastrar com CPF ganha uma fatia do que consumiu.
                  Desmarcado, o recurso some do cardápio e ninguém acumula nada.
                </span>
              </span>
            </label>

            {cashbackLigado && (
              <div className="mt-3 border-t border-border pt-3">
                <label className="block">
                  <Rotulo>Quanto volta para o cliente</Rotulo>
                  <div className="relative">
                    <input
                      name="cashback"
                      type="number"
                      min={0.5}
                      max={20}
                      step={0.5}
                      value={cashback}
                      onChange={(e) => setCashback(e.target.value)}
                      className={cn(CAMPO, 'tabular pr-8')}
                    />
                    <Percento />
                  </div>
                </label>

                {/*
                  As regras ditas por extenso, na tela em que a decisão é tomada.
                  Quem liga isto está comprometendo dinheiro futuro e precisa
                  saber exatamente quanto — não descobrir no fechamento.
                */}
                <ul className="mt-3 space-y-1 text-[12px] leading-snug text-muted-foreground">
                  <li>
                    Incide sobre os <strong>itens</strong>, sem a taxa de serviço —
                    a taxa é da equipe, não receita da casa.
                  </li>
                  <li>
                    O cliente só pode usar <strong>24 horas depois</strong> de ganhar.
                  </li>
                  <li>
                    No resgate, o abatimento vai até <strong>30% da conta</strong>.
                    Quem tem R$ 20 guardados só usa tudo numa conta de R$ 66,67
                    ou mais.
                  </li>
                  <li>
                    Saldo já acumulado <strong>não some</strong> se você desligar
                    depois — só para de crescer.
                  </li>
                </ul>
              </div>
            )}
          </div>
        </Bloco>

        <Bloco titulo="O cliente">
          <label className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
            <input
              name="pedirTelefone"
              type="checkbox"
              checked={telefone}
              onChange={(e) => setTelefone(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--color-brand)]"
            />
            <span className="text-[14px] leading-snug">
              Pedir o telefone ao abrir a mesa
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                Fica mascarado nas telas da equipe. Revelar o número inteiro
                exige permissão e é registrado na auditoria.
              </span>
            </span>
          </label>
        </Bloco>

        {erro && (
          <p
            role="alert"
            className="rounded-md bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical"
          >
            {erro}
          </p>
        )}

        {/* Fixa, como no editor de cardápio: o formulário é longo e o botão não
            pode viver no fim de uma rolagem. */}
        <div className="sticky bottom-0 -mx-1 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pendente || !sujo}
              className="h-11 flex-1 rounded-md bg-brand text-[14px] font-bold text-background disabled:opacity-40"
            >
              {pendente ? 'Salvando…' : sujo ? 'Salvar alterações' : 'Nada para salvar'}
            </button>
            {sujo && !pendente && (
              <p className="shrink-0 text-[12px] text-alert-warning">
                Alterações não salvas
              </p>
            )}
            {salvo && !sujo && (
              <p role="status" className="shrink-0 text-[12px] text-muted-foreground">
                Salvo.
              </p>
            )}
          </div>
        </div>
      </form>
    </main>
  );
}

const CAMPO =
  'mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand';

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-semibold text-muted-foreground">{children}</span>;
}

function Ajuda({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{children}</span>;
}

function Percento() {
  return (
    <span className="pointer-events-none absolute right-3 bottom-3 text-[13px] text-muted-foreground">
      %
    </span>
  );
}
