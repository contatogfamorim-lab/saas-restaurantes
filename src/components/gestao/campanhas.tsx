'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  PauseIcon,
  PlayIcon,
  SendIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { renderMensagem } from '@/lib/marketing/mensagem';
import { SeletorDeSegmento, type Segmento } from './segmento';
import {
  apagarRascunho,
  criarCampanha,
  dispararCampanha,
  editarCampanha,
  montarPublico,
  pararCampanha,
} from '@/app/app/(gestao)/gestao/campanhas/actions';

export interface Campanha {
  id: string;
  titulo: string;
  corpo: string;
  status: string;
  agendadaPara: string | null;
  proximoEnvio: string | null;
  ultimoErro: string | null;
  criadaEm: string;
  segmento: Segmento;
  total: number;
  enviados: number;
  pendentes: number;
  falharam: number;
  pulados: number;
}

/** Para a linha da campanha dizer, depois, para quem aquilo foi. */
const ROTULO_SEGMENTO: Record<string, string> = {
  todos: 'todo mundo',
  com_saldo: 'com cashback guardado',
  sumidos: 'sumidos',
  melhores: 'quem mais gasta',
};

const ROTULO: Record<string, { texto: string; cor: string }> = {
  draft: { texto: 'Rascunho', cor: 'bg-secondary text-muted-foreground' },
  sending: { texto: 'Enviando', cor: 'bg-brand/15 text-brand' },
  paused: { texto: 'Pausada', cor: 'bg-alert-warning/15 text-alert-warning' },
  done: { texto: 'Concluída', cor: 'bg-secondary text-muted-foreground' },
  canceled: { texto: 'Cancelada', cor: 'bg-secondary text-muted-foreground' },
};

export function Campanhas({
  campanhas,
  publico,
  whatsapp,
  tetoDiario,
  enviadasHoje,
}: {
  campanhas: Campanha[];
  publico: number;
  whatsapp: string | null;
  tetoDiario: number;
  enviadasHoje: number;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [escrevendo, setEscrevendo] = useState<Campanha | 'nova' | null>(null);

  const podeDisparar = Boolean(whatsapp) && publico > 0;

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Cartao
          rotulo="Podem receber"
          valor={String(publico)}
          detalhe={
            publico === 0
              ? 'ninguém aceitou ainda'
              : publico === 1
                ? 'pessoa autorizou mensagens'
                : 'pessoas autorizaram mensagens'
          }
          tom={publico === 0 ? 'atencao' : 'neutro'}
        />
        <Cartao
          rotulo="WhatsApp"
          valor={whatsapp ? 'Conectado' : 'Desligado'}
          detalhe={whatsapp ?? 'nenhuma campanha sai assim'}
          tom={whatsapp ? 'bom' : 'atencao'}
          acao={
            whatsapp ? undefined : (
              <Link href="/app/gestao/configuracoes" className="underline">
                Conectar
              </Link>
            )
          }
        />
        <Cartao
          rotulo="Enviadas hoje"
          valor={`${enviadasHoje} / ${tetoDiario}`}
          detalhe={
            enviadasHoje >= tetoDiario
              ? 'teto atingido — volta amanhã'
              : 'o teto protege o número da casa'
          }
          tom={enviadasHoje >= tetoDiario ? 'atencao' : 'neutro'}
        />
      </div>

      {erro && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical"
        >
          {erro}
        </p>
      )}

      {escrevendo ? (
        <Editor
          campanha={escrevendo === 'nova' ? null : escrevendo}
          onFechar={() => setEscrevendo(null)}
          onErro={setErro}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setErro(null);
            setEscrevendo('nova');
          }}
          className="mb-4 h-11 rounded-lg bg-foreground px-5 text-[14px] font-semibold text-background"
        >
          Escrever campanha
        </button>
      )}

      <div className="space-y-3">
        {campanhas.length === 0 && !escrevendo && (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
            Nenhuma campanha ainda.
          </p>
        )}

        {campanhas.map((c) => (
          <Linha
            key={c.id}
            campanha={c}
            podeDisparar={podeDisparar}
            onEditar={() => {
              setErro(null);
              setEscrevendo(c);
            }}
            onErro={setErro}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Cartao({
  rotulo,
  valor,
  detalhe,
  tom,
  acao,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  tom: 'neutro' | 'bom' | 'atencao';
  acao?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {rotulo}
      </p>
      <p
        className={cn(
          'font-display mt-1 text-2xl leading-none',
          tom === 'bom' && 'text-brand',
          tom === 'atencao' && 'text-alert-warning',
        )}
      >
        {valor}
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        {detalhe} {acao}
      </p>
    </div>
  );
}

const CAMPO =
  'mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand';

function Editor({
  campanha,
  onFechar,
  onErro,
}: {
  campanha: Campanha | null;
  onFechar: () => void;
  onErro: (e: string | null) => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [titulo, setTitulo] = useState(campanha?.titulo ?? '');
  const [corpo, setCorpo] = useState(campanha?.corpo ?? '');

  /*
    A PRÉ-VISUALIZAÇÃO, e por que ela não é enfeite.

    O link de saída é colado pelo banco. Sem ver isso acontecendo, o autor
    escreve o link dele — e a mensagem sai com dois, um deles quebrado.

    Os valores são de mentira e a tela diz isso. Mostrar o saldo de um cliente
    real aqui seria trazer dado de gente para uma tela de rascunho, e o número
    mudaria a cada tecla digitada.
  */
  const previa = renderMensagem(
    corpo || 'Sua mensagem aparece aqui.',
    'Ana Paula',
    2500,
    'https://seurestaurante.com.br',
    'aBcD1234',
  );

  function salvar() {
    onErro(null);
    const fd = new FormData();
    fd.set('titulo', titulo);
    fd.set('corpo', corpo);

    iniciar(async () => {
      const r = campanha
        ? await editarCampanha(campanha.id, fd)
        : await criarCampanha(fd);
      if (!r.ok) {
        onErro(r.erro ?? 'Não deu certo');
        return;
      }
      onFechar();
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Nome da campanha
            </span>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={80}
              autoFocus
              placeholder="Cashback liberado — outubro"
              className={CAMPO}
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Só você vê. Serve para achar depois.
            </span>
          </label>

          <label className="mt-4 block">
            <span className="text-[12px] font-semibold text-muted-foreground">
              A mensagem
            </span>
            <textarea
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              maxLength={900}
              rows={7}
              placeholder="Oi {nome}! Seu cashback de {saldo} já está liberado. Vem usar hoje 🍔"
              className={cn(CAMPO, 'resize-y leading-relaxed')}
            />
            <span className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>
                <code className="rounded bg-secondary px-1">{'{nome}'}</code> e{' '}
                <code className="rounded bg-secondary px-1">{'{saldo}'}</code> viram
                os dados de cada pessoa.
              </span>
              <span className={cn(corpo.length > 850 && 'text-alert-warning')}>
                {corpo.length}/900
              </span>
            </span>
          </label>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={salvar}
              disabled={pendente || titulo.trim().length < 2 || corpo.trim().length < 10}
              className="h-10 rounded-lg bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40"
            >
              {pendente ? 'Salvando…' : campanha ? 'Salvar' : 'Criar rascunho'}
            </button>
            <button
              type="button"
              onClick={onFechar}
              className="h-10 rounded-lg px-4 text-[13px] font-medium text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>

        <div>
          <p className="text-[12px] font-semibold text-muted-foreground">
            Como vai chegar
          </p>
          <div className="mt-1.5 rounded-lg bg-secondary/60 p-3">
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{previa}</p>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Nome e saldo aqui são de exemplo. O{' '}
            <strong className="text-foreground">link do fim é obrigatório</strong> e
            entra sozinho, com um endereço diferente para cada pessoa — não
            escreva o seu.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Linha({
  campanha: c,
  podeDisparar,
  onEditar,
  onErro,
}: {
  campanha: Campanha;
  podeDisparar: boolean;
  onEditar: () => void;
  onErro: (e: string | null) => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [montando, setMontando] = useState(false);
  const [segmento, setSegmento] = useState<Segmento>(c.segmento);
  const [quando, setQuando] = useState('');
  // O mínimo do campo é calculado no CLIQUE, não no render.
  //
  // `Date.now()` durante o render é função impura, e o React Compiler recusa —
  // com razão: o valor mudaria a cada re-render, e um `min` que anda sozinho
  // invalidaria a data que a pessoa acabou de escolher.
  const [minimo, setMinimo] = useState('');
  const rotulo = ROTULO[c.status] ?? ROTULO.draft;

  function agir(fn: () => Promise<{ ok: boolean; erro?: string }>) {
    onErro(null);
    iniciar(async () => {
      const r = await fn();
      if (!r.ok) onErro(r.erro ?? 'Não deu certo');
      setConfirmando(false);
    });
  }

  const progresso = c.total > 0 ? Math.round((c.enviados / c.total) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display truncate text-[16px]">{c.titulo}</h3>
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase',
                rotulo.cor,
              )}
            >
              {rotulo.texto}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {c.corpo}
          </p>
        </div>

        <div className="flex shrink-0 gap-1.5">
          {c.status === 'draft' && (
            <>
              <Botao onClick={onEditar} titulo="Editar">
                Editar
              </Botao>
              <Botao
                onClick={() => setMontando(!montando)}
                disabled={pendente}
                titulo="Escolhe para quem vai e monta a lista"
              >
                <UsersIcon className="size-3.5" />
                {c.total > 0 ? 'Refazer lista' : 'Montar lista'}
              </Botao>
            </>
          )}

          {(c.status === 'draft' || c.status === 'paused') && c.pendentes > 0 && (
            <Botao
              onClick={() => {
                setMinimo(paraCampoLocal(new Date(Date.now() + 60_000)));
                setConfirmando(true);
              }}
              disabled={pendente || !podeDisparar}
              destaque
              titulo={
                podeDisparar
                  ? 'Começa a mandar'
                  : 'Conecte o WhatsApp e monte a lista antes'
              }
            >
              <SendIcon className="size-3.5" />
              {c.status === 'paused' ? 'Retomar' : 'Disparar'}
            </Botao>
          )}

          {c.status === 'sending' && (
            <Botao onClick={() => agir(() => pararCampanha(c.id, false))} disabled={pendente}>
              <PauseIcon className="size-3.5" />
              Pausar
            </Botao>
          )}

          {(c.status === 'sending' || c.status === 'paused') && (
            <Botao
              onClick={() => agir(() => pararCampanha(c.id, true))}
              disabled={pendente}
              titulo="Cancela de vez: o que não saiu não sai mais"
            >
              Cancelar
            </Botao>
          )}

          {c.status === 'draft' && (
            <Botao onClick={() => agir(() => apagarRascunho(c.id))} disabled={pendente}>
              <Trash2Icon className="size-3.5" />
            </Botao>
          )}
        </div>
      </div>

      {montando && c.status === 'draft' && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <SeletorDeSegmento valor={segmento} onChange={setSegmento} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() =>
                agir(async () => {
                  const r = await montarPublico(c.id, segmento);
                  if (r.ok) setMontando(false);
                  return r;
                })
              }
              disabled={pendente}
              className="h-9 rounded-lg bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40"
            >
              {pendente ? 'Montando…' : 'Montar esta lista'}
            </button>
            <button
              type="button"
              onClick={() => setMontando(false)}
              className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/*
        A CONFIRMAÇÃO DIZ O NÚMERO.

        "Tem certeza?" não informa nada — a pessoa clica em sim por reflexo. O
        que faz alguém parar é o número: mandar para 12 é uma decisão, mandar
        para 1.240 é outra, e o botão é o mesmo.
      */}
      {confirmando && (
        <div className="mt-3 rounded-lg border border-brand/40 bg-brand/5 p-3">
          <p className="text-[13px] leading-relaxed">
            Isto manda a mensagem para{' '}
            <strong>
              {c.pendentes} {c.pendentes === 1 ? 'pessoa' : 'pessoas'}
            </strong>
            , uma a cada 40–90 segundos. Quem já recebeu não recebe de novo, e
            quem sair da lista no meio deixa de receber na hora.
          </p>

          {/*
            O AGENDAMENTO.

            O banco aceita hora marcada desde que a fila existe, e a tela não
            oferecia — uma capacidade que só o psql alcançava. E ela importa
            para o caso mais comum: escrever a campanha às 15h, de cabeça
            fria, e mandar às 18h, quando a pessoa vai olhar o celular.

            Vazio significa AGORA. Um campo de data obrigatório obrigaria a
            escolher um horário para disparar imediatamente, que é o oposto da
            intenção.
          */}
          <label className="mt-3 block">
            <span className="text-[12px] text-muted-foreground">
              Quando (deixe vazio para mandar agora)
            </span>
            <input
              type="datetime-local"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
              min={minimo}
              className="mt-1 h-10 rounded-lg border border-border bg-background px-2.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() =>
                agir(() =>
                  // O horário sai daqui em ISO com fuso — o `datetime-local` é
                  // uma string sem fuso nenhum, e mandá-la crua faria o
                  // servidor lê-la como UTC. Três horas de diferença numa
                  // campanha agendada é a campanha saindo na hora errada.
                  dispararCampanha(
                    c.id,
                    quando ? new Date(quando).toISOString() : undefined,
                  ),
                )
              }
              disabled={pendente}
              className="h-9 rounded-lg bg-brand px-4 text-[13px] font-semibold text-background disabled:opacity-40"
            >
              {pendente
                ? 'Começando…'
                : quando
                  ? 'Agendar'
                  : 'Sim, pode mandar'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground"
            >
              Agora não
            </button>
          </div>
        </div>
      )}

      {c.total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-brand transition-[width]"
              style={{ width: `${progresso}%` }}
            />
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              <CheckCircle2Icon className="mr-1 inline size-3" />
              {c.enviados} de {c.total} enviadas
            </span>
            <span>{ROTULO_SEGMENTO[c.segmento?.tipo ?? 'todos']}</span>
            {c.pendentes > 0 && <span>{c.pendentes} na fila</span>}
            {c.pulados > 0 && (
              <span title="Saíram da lista antes de a mensagem chegar nelas">
                {c.pulados} {c.pulados === 1 ? 'pulada' : 'puladas'} — saíram da lista
              </span>
            )}
            {c.falharam > 0 && (
              <span className="text-alert-critical">
                <AlertTriangleIcon className="mr-1 inline size-3" />
                {c.falharam} {c.falharam === 1 ? 'falhou' : 'falharam'}
              </span>
            )}
            {c.status === 'draft' && c.agendadaPara && (
              <span className="text-brand">
                agendada para{' '}
                {new Date(c.agendadaPara).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
            {c.status === 'sending' && c.proximoEnvio && (
              <span>
                <PlayIcon className="mr-1 inline size-3" />
                próxima às{' '}
                {new Date(c.proximoEnvio).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </p>
        </div>
      )}

      {c.ultimoErro && (
        <p className="mt-2 text-[11px] text-alert-warning">Último aviso: {c.ultimoErro}</p>
      )}
    </div>
  );
}

function Botao({
  children,
  onClick,
  disabled,
  destaque,
  titulo,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destaque?: boolean;
  titulo?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titulo}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium disabled:opacity-40',
        destaque
          ? 'bg-brand text-background'
          : 'border border-border text-foreground hover:bg-secondary',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Uma data para dentro de um `datetime-local`.
 *
 * `toISOString()` devolve UTC, e o campo interpreta o que recebe como hora
 * LOCAL — colar um ISO ali adianta ou atrasa o mínimo em três horas no Brasil.
 * Este caminho monta a string no fuso do navegador, que é o que o campo espera.
 */
function paraCampoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
