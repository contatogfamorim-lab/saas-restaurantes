'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon, Trash2Icon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  alternarSelo,
  apagarSelo,
  criarSelo,
  editarSelo,
} from '@/app/app/(cardapio)/cardapio/selos/actions';

interface SeloDaLista {
  id: string;
  slug: string;
  label: string;
  color: string;
  animation: 'none' | 'pulse' | 'shine' | 'bounce';
  ativo: boolean;
  interno: boolean;
  emUso: number;
}

const ANIMACOES = [
  { valor: 'none', rotulo: 'Parado' },
  { valor: 'pulse', rotulo: 'Pulsando' },
  { valor: 'shine', rotulo: 'Brilho' },
  { valor: 'bounce', rotulo: 'Pulando' },
] as const;

/** Cores prontas, para quem não quer escolher hexadecimal na mão. */
const PALETA = [
  '#D97A28', '#DC2626', '#3FA34D', '#8B5CF6',
  '#0EA5E9', '#EAB308', '#EC4899', '#64748B',
];

/**
 * Selos do cardápio (§12).
 *
 * A prévia é AO VIVO e usa exatamente o mesmo CSS do card do cliente
 * (`.selo`, `.selo--*` em globals.css). Uma prévia que aproxima o resultado é
 * pior que nenhuma: a pessoa escolhe uma cor achando que ficou legível e
 * descobre o contrário no celular de quem está pagando.
 */
export function EditorDeSelos({ selos }: { selos: SeloDaLista[] }) {
  const [criando, setCriando] = useState(false);

  return (
    <main className="mx-auto max-w-2xl px-5 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl leading-tight">Selos</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            As etiquetas que aparecem acima do nome do prato.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCriando((v) => !v)}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 text-[13px] font-bold text-background"
        >
          <PlusIcon className="size-4" />
          Novo selo
        </button>
      </div>

      {criando && <Formulario onPronto={() => setCriando(false)} />}

      {/*
        O conselho que evita o erro mais comum desta tela. Selo em tudo é o
        mesmo que selo em nada: se todo prato tem etiqueta, o olho para de ver
        etiqueta e a lista volta a ser uma lista.
      */}
      <p className="mt-5 rounded-lg bg-secondary/60 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
        Dois selos por prato já é muito, e animação em todos anula o efeito de
        todos. Guarde o brilho para o que você realmente quer vender hoje.
      </p>

      <ul className="mt-4 space-y-2">
        {selos.map((s) => (
          <Linha key={s.id} selo={s} />
        ))}
      </ul>
    </main>
  );
}

function Formulario({
  selo,
  onPronto,
}: {
  selo?: SeloDaLista;
  onPronto: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [label, setLabel] = useState(selo?.label ?? '');
  const [color, setColor] = useState(selo?.color ?? PALETA[0]);
  const [animation, setAnimation] = useState<SeloDaLista['animation']>(
    selo?.animation ?? 'none',
  );

  function enviar() {
    setErro(null);
    const fd = new FormData();
    fd.set('label', label);
    fd.set('color', color);
    fd.set('animation', animation);

    iniciar(async () => {
      const r = selo ? await editarSelo(selo.id, fd) : await criarSelo(fd);
      if (!r.ok) {
        setErro(r.erro ?? 'Não deu certo');
        return;
      }
      onPronto();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4">
      <label className="block">
        <span className="text-[12px] font-semibold text-muted-foreground">
          O que vai escrito
        </span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={18}
          placeholder="SEM GLÚTEN"
          className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-[15px] uppercase outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Até 18 caracteres. Mais que isso não cabe no card.
        </span>
      </label>

      <div className="mt-4">
        <span className="text-[12px] font-semibold text-muted-foreground">Cor</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {PALETA.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Cor ${c}`}
              className={cn(
                'size-8 rounded-full border-2 transition-transform',
                color.toLowerCase() === c.toLowerCase()
                  ? 'scale-110 border-foreground'
                  : 'border-transparent',
              )}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Outra cor"
            className="size-8 cursor-pointer rounded-full border border-border bg-transparent"
          />
        </div>
      </div>

      <div className="mt-4">
        <span className="text-[12px] font-semibold text-muted-foreground">Animação</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {ANIMACOES.map((a) => (
            <button
              key={a.valor}
              type="button"
              onClick={() => setAnimation(a.valor)}
              className={cn(
                'h-9 rounded-md px-3 text-[13px] font-semibold',
                animation === a.valor ? 'bg-brand text-background' : 'bg-secondary',
              )}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-background p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Como o cliente vê
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`selo selo--${animation}`}
            style={{ '--selo': color } as React.CSSProperties}
          >
            {label || 'SEU SELO'}
          </span>
          <span className="font-display text-[17px]">Smash Clássico</span>
        </div>
      </div>

      {erro && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-alert-critical/10 px-3 py-2 text-[13px] text-alert-critical"
        >
          {erro}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={enviar}
          disabled={pendente || label.trim().length < 2}
          className="h-11 flex-1 rounded-md bg-brand text-[14px] font-bold text-background disabled:opacity-40"
        >
          {pendente ? 'Salvando…' : selo ? 'Salvar' : 'Criar selo'}
        </button>
        <button
          type="button"
          onClick={onPronto}
          className="h-11 rounded-md bg-secondary px-4 text-[14px] font-semibold"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Linha({ selo }: { selo: SeloDaLista }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
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

  if (editando) {
    return (
      <li>
        <Formulario selo={selo} onPronto={() => setEditando(false)} />
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <span
          className={cn(`selo selo--${selo.animation}`, !selo.ativo && 'opacity-40')}
          style={{ '--selo': selo.color } as React.CSSProperties}
        >
          {selo.label}
        </span>

        <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          {selo.emUso > 0
            ? `${selo.emUso} ${selo.emUso === 1 ? 'prato' : 'pratos'}`
            : 'nenhum prato'}
          {!selo.ativo && ' · desativado'}
        </span>

        <button
          type="button"
          onClick={() => setEditando(true)}
          className="h-8 rounded-md bg-secondary px-2.5 text-[12px] font-semibold"
        >
          Editar
        </button>

        <button
          type="button"
          onClick={() => acao(() => alternarSelo(selo.id, !selo.ativo))}
          disabled={pendente}
          className="h-8 rounded-md bg-secondary px-2.5 text-[12px] font-semibold disabled:opacity-50"
        >
          {selo.ativo ? 'Desativar' : 'Ativar'}
        </button>

        {/* Selo do sistema e selo em uso não mostram lixeira: o banco recusaria
            de qualquer jeito, e um botão que só serve para dar erro é pior que
            botão nenhum. Desativar é o caminho, e ele está logo ao lado. */}
        {!selo.interno && selo.emUso === 0 && (
          <button
            type="button"
            onClick={() => acao(() => apagarSelo(selo.id))}
            disabled={pendente}
            aria-label={`Apagar ${selo.label}`}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            <Trash2Icon className="size-4" />
          </button>
        )}
      </div>

      {erro && (
        <p role="alert" className="mt-2 text-[12px] text-alert-critical">
          {erro}
        </p>
      )}
    </li>
  );
}
