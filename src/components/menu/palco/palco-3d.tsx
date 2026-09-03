'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';

import { Palco } from '@/lib/palco/palco';

/**
 * A casca React do palco: o canvas único e o contexto que as vitrines usam
 * para se registrar nele.
 *
 * O canvas é `fixed inset-0` e `pointer-events-none`. Ele não participa do
 * layout e não recebe toque: quem recebe é a âncora de cada card, que continua
 * sendo DOM normal. Isso é o que mantém o cardápio inteiro funcionando como
 * sempre funcionou — rolagem nativa, `sticky`, leitor de tela, botão que abre
 * o item — com o 3D pousado por cima em vez de substituindo tudo.
 *
 * AS TRÊS CAMADAS, E POR QUE ELAS SÃO TRÊS
 *
 * O canvas é UMA folha só para a página inteira, então ele não pode ficar nem
 * no fundo de tudo nem na frente de tudo:
 *
 *   z-0   fundo dos cards, borda, cantos arredondados — DOM
 *   z-10  o canvas: todos os pratos do cardápio, de uma vez
 *   z-20  nome, preço, selo, botão — DOM de novo, por cima do prato
 *
 * Errar isso é o defeito mais fácil de cometer aqui e o mais difícil de
 * diagnosticar: com o canvas em `z-0`, o `bg-card` do próprio card pinta por
 * cima e os pratos DESAPARECEM — enquanto o medidor jura que desenhou tudo,
 * porque desenhou mesmo. Foi exatamente o que aconteceu na primeira versão.
 *
 * O card não pode carregar `z-index` próprio: `position: relative` sem
 * `z-index` não cria contexto de empilhamento, e é isso que deixa o canvas
 * fixo passar entre o fundo e o texto do MESMO elemento.
 */

const PalcoCtx = createContext<Palco | null>(null);

/**
 * Quem NÃO recebe 3D.
 *
 * Nenhum destes casos é exótico num restaurante: celular velho de cliente,
 * plano de dados no talo, economia de dados ligada porque o mês virou. Em
 * qualquer um deles a foto de 50 KB continua sendo um cardápio excelente, e
 * insistir no 3D entrega uma tela preta ou um aparelho travado.
 */
let veredito: boolean | null = null;

export function podeRenderizar(): boolean {
  if (typeof window === 'undefined') return false;

  // Guardado: a checagem abre um contexto WebGL2 só para jogar fora, e ela é
  // consultada pelo provedor e por quem desenha o aviso. Duas vezes já é uma
  // a mais do que o necessário.
  if (veredito !== null) return veredito;
  veredito = medir();
  return veredito;
}

function medir(): boolean {

  const conexao = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (conexao?.saveData) return false;

  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memoria === 'number' && memoria < 4) return false;

  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function PalcoProvider({ children }: { children: React.ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [palco, setPalco] = useState<Palco | null>(null);

  useEffect(() => {
    if (!canvas.current || !podeRenderizar()) return;

    const p = new Palco(canvas.current);

    // Alça de depuração, só em desenvolvimento. O palco desenha por conta
    // própria e dorme sozinho, então não há como inspecioná-lo pelo React
    // DevTools no momento em que ele está desenhando. Com isto, a bancada e o
    // console conseguem forçar um quadro e ler os contadores.
    if (process.env.NODE_ENV === 'development') {
      (window as unknown as { __palco?: Palco }).__palco = p;
    }

    setPalco(p);

    return () => {
      setPalco(null);
      p.destruir();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvas}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-10"
      />
      <PalcoCtx value={palco}>{children}</PalcoCtx>
    </>
  );
}

export function usePalco(): Palco | null {
  return useContext(PalcoCtx);
}

/**
 * A âncora. Um retângulo vazio no lugar exato onde o prato deve aparecer.
 *
 * `fonte` é a URL de um GLB ou uma função que monta o objeto na hora. A função
 * é chamada UMA vez, e só quando o palco existe — card que nunca chega perto da
 * viewport nunca instancia geometria nenhuma.
 */
export function Vitrine({
  fonte,
  className,
}: {
  fonte: string | (() => THREE.Object3D);
  className?: string;
}) {
  const palco = usePalco();
  const el = useRef<HTMLDivElement>(null);
  const fonteRef = useRef(fonte);

  // A referência é atualizada num efeito, não no render: escrever em ref
  // durante o render é o que faz o React discordar de si mesmo no modo
  // concorrente. Como este efeito é declarado ANTES do de registro, e o valor
  // inicial da ref já é o certo na montagem, o registro sempre lê a versão boa.
  useEffect(() => {
    fonteRef.current = fonte;
  });

  useEffect(() => {
    if (!palco || !el.current) return;
    const f = fonteRef.current;
    return palco.registrar(el.current, typeof f === 'string' ? f : f());
  }, [palco]);

  // `touch-action: pan-y` deixa a rolagem vertical passar direto e reserva só o
  // arrasto horizontal para girar o prato. Sem isso, o gesto de descer a lista
  // começando em cima de um prato ficaria travado.
  return <div ref={el} className={className} style={{ touchAction: 'pan-y' }} />;
}
