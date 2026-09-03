'use client';

import { useEffect, useRef, useState } from 'react';

import { usePalco } from './palco-3d';
import { SessaoNaMesa, abrirQuickLook, suporteDeAr, type SuporteDeAr } from '@/lib/palco/ar';

/**
 * O botão que põe o prato na mesa, em tamanho real.
 *
 * Ele só aparece se o aparelho der conta — `suporteDeAr()` é consultado antes
 * de renderizar qualquer coisa. Botão que abre e falha é pior que botão nenhum,
 * ainda mais numa tela que o cliente abriu para decidir o que pedir.
 *
 * O texto NÃO diz "realidade aumentada" nem "ver em 3D". Diz o que a coisa faz:
 * mostra o tamanho. É a diferença entre anunciar a tecnologia e anunciar a
 * resposta que o cliente estava procurando.
 */

interface Props {
  /** GLB do nível hero — só é baixado quando o dedo encosta aqui. */
  glb: string;
  /** USDZ equivalente. Sem ele, o iPhone não recebe o botão. */
  usdz?: string;
  nome: string;
}

type Estado = 'fechado' | 'carregando' | 'procurando' | 'na-mesa' | 'erro';

export function VerNaMesa({ glb, usdz, nome }: Props) {
  const palco = usePalco();
  const [suporte, setSuporte] = useState<SuporteDeAr | null>(null);
  const [estado, setEstado] = useState<Estado>('fechado');
  const sobreposicao = useRef<HTMLDivElement>(null);
  const sessao = useRef<SessaoNaMesa | null>(null);

  useEffect(() => {
    let vivo = true;
    void suporteDeAr().then((s) => {
      if (vivo) setSuporte(s);
    });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => () => void sessao.current?.fechar(), []);

  // Sem suporte, ou iPhone sem o USDZ gerado ainda: o botão não existe.
  if (suporte === null || suporte === 'nenhum') return null;
  if (suporte === 'quicklook' && !usdz) return null;

  async function abrir() {
    if (suporte === 'quicklook') {
      // O Quick Look é um visualizador do SISTEMA: a página sai de cena e volta
      // depois. Nada a carregar aqui, nada a pausar — o iOS assume tudo.
      abrirQuickLook({ glb, usdz, nome });
      return;
    }

    if (!palco || !sobreposicao.current) return;

    setEstado('carregando');

    try {
      const modelo = await palco.carregar(glb);

      const s = new SessaoNaMesa();
      sessao.current = s;

      s.aoPousar = () => setEstado('na-mesa');
      s.aoEncerrar = () => {
        sessao.current = null;
        setEstado('fechado');
        palco.retomar();
      };

      // O palco só para DEPOIS que a sessão abriu: se `requestSession` for
      // recusada (permissão negada, aparelho ocupado), a lista atrás continua
      // rodando como se nada tivesse acontecido.
      await s.abrir(modelo, sobreposicao.current);
      palco.pausar();
      setEstado('procurando');
    } catch (erro) {
      console.error('[ar] não abriu:', erro);
      sessao.current = null;
      setEstado('erro');
      palco?.retomar();
    }
  }

  const aberto = estado === 'procurando' || estado === 'na-mesa';

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={estado === 'carregando'}
        className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-foreground disabled:opacity-60"
      >
        {estado === 'carregando' ? 'Preparando…' : 'Ver o tamanho na mesa'}
      </button>

      {estado === 'erro' && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Não consegui abrir a câmera. Verifique a permissão e tente de novo.
        </p>
      )}

      {/*
        A sobreposição é o que continua sendo DOM por cima do vídeo da câmera.
        Fica sempre montada porque o WebXR quer o elemento ANTES de a sessão
        abrir — `domOverlay.root` é lido na hora do pedido — e some com `hidden`
        em vez de deixar de existir.
      */}
      <div
        ref={sobreposicao}
        hidden={!aberto}
        className="fixed inset-0 z-50 flex flex-col justify-between p-4"
      >
        <p className="self-start rounded-lg bg-black/70 px-3 py-2 text-[13px] font-semibold text-white">
          {estado === 'procurando'
            ? 'Aponte para a mesa e toque para pousar'
            : `${nome}, no tamanho real`}
        </p>

        <div className="flex gap-2">
          {estado === 'na-mesa' && (
            <button
              type="button"
              onClick={() => {
                sessao.current?.reposicionar();
                setEstado('procurando');
              }}
              className="rounded-lg bg-white/90 px-4 py-2.5 text-[14px] font-semibold text-black"
            >
              Mover
            </button>
          )}
          <button
            type="button"
            onClick={() => void sessao.current?.fechar()}
            className="rounded-lg bg-white/90 px-4 py-2.5 text-[14px] font-semibold text-black"
          >
            Sair
          </button>
        </div>
      </div>
    </>
  );
}
