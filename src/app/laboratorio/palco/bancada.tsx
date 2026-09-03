'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { PalcoProvider, Vitrine, usePalco, podeRenderizar } from '@/components/menu/palco/palco-3d';
import { VerNaMesa } from '@/components/menu/palco/ver-na-mesa';
import { pratoDeTeste, CATALOGO, type Detalhe } from '@/lib/palco/pratos-de-teste';
import type { InfoDoPalco } from '@/lib/palco/palco';

const NOMES = [
  'Burger da casa', 'Pizza margherita', 'Ramen de costela',
  'Smash duplo', 'Calabresa artesanal', 'Caldo verde',
  'Cheddar bacon', 'Portuguesa', 'Sopa de cebola',
];

/**
 * Bancada de teste do palco.
 *
 * O que ela existe para responder, em ordem de importância:
 *
 *   1. Trinta cards com 3D mantêm 60 fps rolando num celular de verdade?
 *   2. O laço realmente DORME com o dedo parado? (o medidor mostra "dormindo")
 *   3. Quantos triângulos cabem antes de cair — ou seja, qual é o teto do
 *      modelo hero que a digitalização pode entregar?
 *   4. O aparelho esquenta depois de dois minutos de uso?
 *   5. Rolando rápido, os pratos chegam na ordem em que aparecem?
 *
 * As quatro primeiras o medidor e o botão de detalhe respondem. A quinta é o
 * modo ARQUIVO, que passa pela rede de verdade: fila, cancelamento e
 * decodificação Draco. A do calor só a mão sente, e é por isso que esta página
 * existe em vez de um teste automatizado.
 */

/** Procedural monta em memória; arquivo passa pela rede e pelo Draco. */
type Origem = 'memoria' | 'arquivo';

function Medidor() {
  const palco = usePalco();
  const [info, setInfo] = useState<InfoDoPalco | null>(null);

  useEffect(() => {
    if (!palco) return;
    const id = setInterval(() => setInfo(palco.info()), 250);
    return () => clearInterval(id);
  }, [palco]);

  if (!info) return null;

  const saude = info.fps >= 55 ? '#22c55e' : info.fps >= 30 ? '#eab308' : '#ef4444';

  return (
    <div className="tabular fixed right-2 top-2 z-30 rounded-lg bg-black/80 px-3 py-2 text-[11px] leading-relaxed text-white backdrop-blur">
      <div>
        fps{' '}
        <b style={{ color: info.dormindo ? '#64748b' : saude }}>
          {info.dormindo ? 'dormindo' : info.fps}
        </b>
      </div>
      <div>visíveis {info.visiveis}</div>
      <div>chamadas {info.chamadas}</div>
      <div>triângulos {info.triangulos.toLocaleString('pt-BR')}</div>
      <div>geometrias {info.geometrias}</div>
      <div>rede {(info.bytes / 1024).toFixed(0)} KB</div>
      {info.faltando > 0 && <div style={{ color: '#eab308' }}>faltam {info.faltando}</div>}
    </div>
  );
}

function Card({
  i,
  detalhe,
  origem,
}: {
  i: number;
  detalhe: Detalhe;
  origem: Origem;
}) {
  const receita = CATALOGO[i % CATALOGO.length].nome;
  const nivel = detalhe === 1 ? 'card' : 'hero';

  const fonte =
    origem === 'arquivo'
      ? `/modelos-de-teste/${receita}-${nivel}.glb`
      : () => pratoDeTeste(receita, detalhe).objeto;

  return (
    <article className="relative overflow-hidden rounded-2xl border border-border bg-card">
      {/* A vitrine é o card inteiro; o texto vem por cima, em DOM. */}
      <Vitrine fonte={fonte} className="h-[240px] w-full" />
      <div className="relative z-20 -mt-10 px-4 pb-4">
        <h3 className="font-display text-[19px] leading-tight text-foreground">
          {NOMES[i % NOMES.length]} <span className="text-muted-foreground">· {receita}</span>
        </h3>
        <p className="tabular mt-1 text-[15px] font-semibold text-foreground">
          R$ {(28 + (i % 7) * 6).toFixed(2).replace('.', ',')}
        </p>

        {/* Só no modo arquivo: o AR precisa de um GLB de verdade para entregar,
            e prato montado em memória não tem URL. */}
        {origem === 'arquivo' && (
          <div className="mt-2">
            <VerNaMesa
              glb={`/modelos-de-teste/${receita}-hero.glb`}
              nome={NOMES[i % NOMES.length]}
            />
          </div>
        )}
      </div>
    </article>
  );
}

function Botao({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-[12px] font-semibold ${
        ativo ? 'bg-primary text-primary-foreground' : 'bg-accent text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

export function Bancada() {
  const [detalhe, setDetalhe] = useState<Detalhe>(1);
  const [quantos, setQuantos] = useState(30);
  const [origem, setOrigem] = useState<Origem>('arquivo');

  // Capacidade do aparelho não muda no meio da sessão, então `subscribe` não
  // assina nada. No servidor presume-se apto: o aviso só deve aparecer para
  // quem de fato caiu para a foto, e nunca piscar durante a hidratação.
  const apto = useSyncExternalStore(
    () => () => {},
    podeRenderizar,
    () => true,
  );

  const custo = pratoDeTeste('burger-1', detalhe).triangulos;

  // Remontar tudo ao trocar de modo: cada troca é um teste novo, e reaproveitar
  // vitrine antiga mascararia justamente o que se quer medir — a chegada.
  const geracao = `${origem}-${detalhe}-${quantos}`;

  return (
    <PalcoProvider key={geracao}>
      <Medidor />

      <div className="mx-auto max-w-md px-3 py-4">
        <header className="relative z-20 mb-4 rounded-xl border border-border bg-card p-3">
          <h1 className="font-display text-[22px] leading-tight">Palco 3D — bancada</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Role a lista: os pratos giram com o dedo. Pare de rolar e o laço
            dorme — o medidor mostra.
            {apto === false &&
              ' Este aparelho caiu para a foto (sem WebGL2, pouca memória ou economia de dados).'}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Botao ativo={origem === 'arquivo'} onClick={() => setOrigem('arquivo')}>
              GLB pela rede
            </Botao>
            <Botao ativo={origem === 'memoria'} onClick={() => setOrigem('memoria')}>
              procedural
            </Botao>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {([1, 2, 4] as const).map((d) => (
              <Botao key={d} ativo={detalhe === d} onClick={() => setDetalhe(d)}>
                {d === 1 ? 'card (leve)' : d === 2 ? 'médio' : 'hero (pesado)'}
              </Botao>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {[10, 30, 60].map((n) => (
              <Botao key={n} ativo={quantos === n} onClick={() => setQuantos(n)}>
                {n} itens
              </Botao>
            ))}
          </div>

          <p className="tabular mt-2 text-[11px] text-muted-foreground">
            {origem === 'arquivo'
              ? `arquivos ${detalhe === 1 ? 'card' : 'hero'} — 5,6 a 105 KB cada, já em Draco`
              : `~${custo.toLocaleString('pt-BR')} triângulos por prato, montados em memória`}
            {detalhe === 2 && origem === 'arquivo' && ' (o nível médio só existe procedural)'}
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {Array.from({ length: quantos }, (_, i) => (
            <Card key={i} i={i} detalhe={detalhe} origem={origem} />
          ))}
        </div>
      </div>
    </PalcoProvider>
  );
}
