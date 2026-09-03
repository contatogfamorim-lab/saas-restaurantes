'use client';

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { Carregador } from './carregador';

/**
 * O palco: UM canvas WebGL para o cardápio inteiro.
 *
 * POR QUE NÃO UM VISUALIZADOR POR CARD
 *
 * Cada `<model-viewer>` — ou cada `WebGLRenderer` — abre o próprio contexto
 * WebGL. O navegador limita quantos existem ao mesmo tempo: algo entre 8 e 16
 * no celular, e ao estourar ele DESCARTA os mais antigos sem avisar. Um
 * cardápio de trinta itens com um renderer por card não fica lento; fica com
 * metade dos pratos em preto, sem uma linha no console dizendo por quê.
 *
 * Então: um contexto, um canvas do tamanho da viewport, `position: fixed` e
 * `pointer-events: none`. Cada card guarda uma `<div>` vazia como âncora, e a
 * cada quadro o palco lê o retângulo dessas âncoras e desenha o prato de cada
 * uma numa REGIÃO RECORTADA do mesmo canvas (`gl.scissor` + `gl.viewport`).
 * O DOM continua sendo o dono do layout — o 3D só preenche os buracos que ele
 * deixou. Rolagem, sticky, teclado do celular, tudo continua funcionando,
 * porque nada disso é problema do WebGL.
 *
 * O SONO É PARTE DO DESENHO, NÃO OTIMIZAÇÃO POSTERIOR
 *
 * A rotação é AMARRADA À ROLAGEM, não a um relógio. Não existe giro automático.
 * A consequência é a melhor propriedade deste arquivo: com o dedo parado, o
 * laço de animação PARA. Zero trabalho de GPU, zero bateria, zero calor — e o
 * último quadro fica no canvas, porque ninguém limpou. O cliente está sentado
 * numa mesa esperando comida com o celular na mão; um cardápio que esquenta o
 * aparelho é um cardápio que ele fecha.
 *
 * O que acorda o laço: rolagem, arrasto num prato, redimensionamento, prato
 * novo entrando em cena. O que o adormece: todo mundo em repouso.
 */

/** Campo de visão vertical. Estreito de propósito: teleobjetiva achata menos
 *  a comida do que grande-angular, que engorda a frente do prato. */
const FOV = 32;

/** Inclinação da câmera acima do horizonte, em radianos (~30°). */
const INCLINACAO = 0.52;

/** Respiro entre o prato e a borda do card. 1 encostaria nas quatro bordas. */
const FOLGA = 1.12;

/** Rad de giro por pixel rolado. ~250 px de rolagem viram meia volta. */
const GIRO_POR_PIXEL = 0.006;

/** Rad por pixel arrastado com o dedo em cima do prato. */
const GIRO_POR_ARRASTO = 0.01;

/** Atrito do giro por inércia depois que o dedo sai. 0.92 ≈ para em ~1 s. */
const ATRITO = 0.92;

/** Abaixo disto o giro é imperceptível e o laço pode dormir. */
const REPOUSO = 0.0004;

/**
 * Teto de densidade de pixel. Em tela 3x um card de 320 px viraria 960 px de
 * largura de fragmentos — o triplo do custo de preenchimento por um ganho que
 * ninguém enxerga em prato com sombra suave.
 */
const DPR_MAX = 2;

/** Margem, em px, para começar a desenhar antes do card entrar de fato. */
const MARGEM_VISIVEL = 120;

interface Medida {
  centro: THREE.Vector3;
  meiaLargura: number;
  meiaAltura: number;
  alcance: number;
  /** Distância do centro do objeto até a base dele, em metros. */
  base: number;
}

export interface InfoDoPalco {
  fps: number;
  visiveis: number;
  chamadas: number;
  triangulos: number;
  geometrias: number;
  texturas: number;
  /** Bytes de modelo que desceram da rede nesta sessão. */
  bytes: number;
  /** Vitrines ainda esperando o arquivo. */
  faltando: number;
  dormindo: boolean;
}

interface Vitrine {
  el: HTMLElement;
  cena: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * O que gira. `null` enquanto o modelo não chegou da rede — a vitrine já
   * existe, ocupa o lugar dela e conta para a fila, mas não desenha nada.
   */
  alvo: THREE.Object3D | null;
  /** Medidas do alvo. `null` junto com ele. */
  medida: Medida | null;
  /** Aspecto com que a câmera foi enquadrada da última vez. */
  aspecto: number;
  /** Giro acumulado por arrasto, independente da rolagem. */
  giroProprio: number;
  /** Velocidade residual do arrasto, em rad/quadro. */
  inercia: number;
  visivel: boolean;
}

export class Palco {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly vitrines = new Set<Vitrine>();
  private readonly ambiente: THREE.Texture;
  /** Uma textura de sombra para todos os pratos da página. */
  private readonly borrao: THREE.Texture;
  private readonly observador: IntersectionObserver;
  private readonly carregador = new Carregador();

  private rolagem = 0;
  private laco = 0;
  private dormindo = true;
  private destruido = false;
  private pausado = false;

  /** Quadros com tudo em repouso. Dois seguidos e o laço dorme. */
  private quadrosParados = 0;

  private ultimoQuadro = 0;
  private fps = 0;

  private readonly reduzido: boolean;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // `alpha` porque o canvas fica ATRÁS do DOM: o fundo do card, o tema
      // claro/escuro e as bordas arredondadas são do CSS, e o 3D tem que
      // pousar em cima sem trazer retângulo próprio.
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_MAX));
    this.renderer.setClearColor(0x000000, 0);

    // `info.autoReset` zera o contador no INÍCIO de cada `render()`. Como um
    // quadro aqui são N chamadas de `render()` — uma por vitrine —, com ele
    // ligado o medidor mostraria só o custo do ÚLTIMO prato desenhado e diria
    // que o cardápio inteiro custa nove chamadas. O contador passa a ser zerado
    // à mão, uma vez por quadro, em `desenhar()`.
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 1.0 e não mais: prato com molho estoura o realce fácil, e comida
    // superexposta parece plástico.
    this.renderer.toneMappingExposure = 1;

    // Ambiente PROCEDURAL: um estúdio de caixa branca gerado em código, sem
    // baixar HDRI nenhuma. É a diferença entre "tem 3D" e "parece caro" —
    // material físico sem reflexo do entorno fica fosco e morto — e custa
    // uma passada de PMREM no primeiro quadro, uma vez para a página toda.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const sala = new RoomEnvironment();
    this.ambiente = pmrem.fromScene(sala, 0.04).texture;
    sala.dispose();
    pmrem.dispose();

    this.borrao = borraoDeSombra();
    this.reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          for (const v of this.vitrines) {
            if (v.el === entrada.target) v.visivel = entrada.isIntersecting;
          }
        }
        this.acordar();
      },
      { rootMargin: `${MARGEM_VISIVEL}px 0px` },
    );

    this.rolagem = window.scrollY;
    this.dimensionar();

    window.addEventListener('scroll', this.aoRolar, { passive: true });
    window.addEventListener('resize', this.aoRedimensionar);
    document.addEventListener('visibilitychange', this.aoTrocarAba);
  }

  /**
   * Liga uma âncora do DOM a um prato. Devolve a função que desfaz.
   *
   * A fonte pode ser um objeto já montado (é o caso dos pratos procedurais da
   * bancada) ou a URL de um GLB. No segundo caso a vitrine nasce VAZIA e entra
   * na fila do carregador: ela já ocupa o lugar dela, já conta como visível, e
   * o prato aparece quando chega. Enquanto isso o card mostra a foto, que é
   * DOM e não depende disto para nada.
   *
   * Cada prato entra numa cena PRÓPRIA — cenas são baratas, e o que custa caro
   * (geometria, textura, programa de shader) continua compartilhado pelo
   * renderer. Cena por vitrine evita o vaivém de `add`/`remove` a cada quadro,
   * que suja a matriz de todo mundo.
   */
  registrar(el: HTMLElement, fonte: THREE.Object3D | string): () => void {
    const cena = new THREE.Scene();
    cena.environment = this.ambiente;

    // Direcional fraca por cima da ambiente: a RoomEnvironment ilumina bem mas
    // não crava direção, e sem uma direção o prato fica sem relevo.
    const chave = new THREE.DirectionalLight(0xffffff, 1.6);
    chave.position.set(2.5, 4, 2);
    cena.add(chave);

    const vitrine: Vitrine = {
      el,
      cena,
      camera: new THREE.PerspectiveCamera(FOV, 1, 0.01, 100),
      alvo: null,
      medida: null,
      aspecto: 0,
      giroProprio: 0,
      inercia: 0,
      visivel: false,
    };

    let desistir: (() => void) | null = null;

    if (typeof fonte === 'string') {
      // A urgência é RELIDA pelo carregador a cada rodada, e é por isso que ela
      // é uma função: o cliente rola rápido e muda de ideia, e uma fila que
      // decidiu a ordem no momento do pedido entrega o cardápio de trás para
      // frente.
      const pedido = this.carregador.pedir(fonte, () => this.urgencia(vitrine));
      desistir = pedido.desistir;

      pedido.pronto
        .then((modelo) => {
          this.montar(vitrine, modelo);
          this.acordar();
        })
        .catch((erro) => {
          // Cancelamento é o funcionamento normal — card que saiu de cena antes
          // de o modelo chegar. Só o resto merece console.
          if (erro instanceof DOMException && erro.name === 'AbortError') return;
          console.error('[palco] modelo não carregou:', fonte, erro);
        });
    } else {
      this.montar(vitrine, fonte);
    }

    this.vitrines.add(vitrine);
    this.observador.observe(el);
    this.ligarArrasto(vitrine);
    this.acordar();

    return () => {
      desistir?.();
      this.observador.unobserve(el);
      this.vitrines.delete(vitrine);
      vitrine.cena.clear();
    };
  }

  /**
   * Põe o modelo em cena: pivô, sombra e enquadramento.
   *
   * Separado de `registrar` porque acontece DEPOIS, quando o arquivo chega — e
   * porque vai acontecer de novo quando o modelo leve for trocado pelo pesado.
   */
  private montar(v: Vitrine, alvo: THREE.Object3D): void {
    if (v.alvo) v.cena.remove(v.alvo);

    // ENQUADRAMENTO DERIVADO DO OBJETO, NÃO CHUTADO.
    //
    // Os modelos são autorados em METROS, no tamanho real do prato — é o que o
    // AR exige, e ter duas escalas (uma "bonita para o card", outra "certa para
    // a mesa") é como se erra tamanho real. Então a câmera é que se ajusta ao
    // prato, e não o contrário.
    const medida = medir(alvo);

    // O giro tem que ser em torno do EIXO do prato, e o eixo raramente passa
    // pela origem do arquivo. Sem este pivô, prato levemente descentrado gira
    // fazendo uma órbita — parece que a câmera é que está bêbada.
    const pivo = new THREE.Group();
    pivo.position.copy(medida.centro);
    alvo.position.sub(medida.centro);
    pivo.add(alvo);

    // A SOMBRA É DO PALCO, NÃO DO MODELO.
    //
    // Ela fica fora do arquivo por dois motivos. O primeiro é de custo: é o
    // detalhe com maior retorno visual da lista inteira — objeto sem contato
    // com o chão lê como adesivo colado na tela, por melhor que seja o
    // material — e sai de graça aqui, com uma textura de 128 px compartilhada
    // por todos os pratos. O segundo é de pipeline: o que vem da digitalização
    // é comida, e esperar que quem exportou tenha lembrado de pôr um plano de
    // sombra na escala certa é esperar o que não vai acontecer.
    //
    // Fica FORA do pivô: sombra não gira junto com o prato.
    v.cena.add(this.sombra(medida), pivo);

    v.alvo = pivo;
    v.medida = medida;
    v.aspecto = 0; // força reenquadrar no próximo quadro
  }

  /**
   * Quão urgente é este prato, para a fila do carregador.
   *
   * Distância do centro do card ao centro da tela, em pixels. Quem está debaixo
   * do polegar agora vence; quem está longe espera; quem nem tem retângulo
   * ainda (card que nunca foi disposto) fica no fim.
   */
  private urgencia(v: Vitrine): number {
    const r = v.el.getBoundingClientRect();
    if (r.height === 0) return Infinity;
    return Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2);
  }

  /**
   * Busca um modelo fora da lista — o hero para tela cheia ou para o AR.
   *
   * Urgência negativa: fura a fila inteira. É o único pedido que o cliente fez
   * de propósito, tocando num botão; qualquer card esperando pode esperar mais.
   */
  carregar(url: string): Promise<THREE.Object3D> {
    return this.carregador.pedir(url, () => -1).pronto;
  }

  /**
   * Congela o palco enquanto outra coisa usa a tela (a sessão de AR).
   *
   * Sem isto, os trinta recortes continuariam sendo desenhados atrás de uma
   * sessão imersiva que ocupa o aparelho inteiro — gastando bateria para
   * produzir pixels que ninguém vai ver, no exato momento em que a GPU está
   * mais ocupada.
   */
  pausar(): void {
    this.pausado = true;
    cancelAnimationFrame(this.laco);
    this.dormindo = true;
  }

  retomar(): void {
    this.pausado = false;
    this.acordar();
  }

  info(): InfoDoPalco {
    const r = this.renderer.info;
    let visiveis = 0;
    let faltando = 0;
    for (const v of this.vitrines) {
      if (v.visivel) visiveis++;
      if (!v.alvo) faltando++;
    }

    return {
      fps: Math.round(this.fps),
      visiveis,
      chamadas: r.render.calls,
      triangulos: r.render.triangles,
      geometrias: r.memory.geometries,
      texturas: r.memory.textures,
      bytes: this.carregador.bytes,
      faltando,
      dormindo: this.dormindo,
    };
  }

  destruir(): void {
    this.destruido = true;
    cancelAnimationFrame(this.laco);
    this.observador.disconnect();
    window.removeEventListener('scroll', this.aoRolar);
    window.removeEventListener('resize', this.aoRedimensionar);
    document.removeEventListener('visibilitychange', this.aoTrocarAba);
    this.carregador.destruir();
    this.ambiente.dispose();
    this.borrao.dispose();
    this.renderer.dispose();
  }

  /**
   * Disco borrado sob o prato, do tamanho da planta dele.
   *
   * `depthWrite: false` para não interferir no que vem por cima, e 2 mm ABAIXO
   * da base: coplanar com o fundo do prato, as duas superfícies brigam pela
   * profundidade e a louça ganha faixas radiais claras e escuras.
   */
  private sombra(medida: Medida): THREE.Mesh {
    const largura = medida.meiaLargura * 3;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(largura, largura),
      new THREE.MeshBasicMaterial({
        map: this.borrao,
        transparent: true,
        depthWrite: false,
      }),
    );

    m.rotation.x = -Math.PI / 2;
    // `medida.base` é a distância do centro até a base, e o pivô já pôs o
    // centro na origem — então a base está aqui embaixo.
    m.position.y = -medida.base - 0.002;
    return m;
  }

  // ---------------------------------------------------------------------------

  private aoRolar = () => {
    this.rolagem = window.scrollY;
    this.acordar();
  };

  private aoRedimensionar = () => {
    this.dimensionar();
    this.acordar();
  };

  /**
   * Aba escondida: o navegador já estrangula o rAF, mas não em todo aparelho e
   * não de imediato. Desligar na mão é o que garante que o celular no bolso
   * não continua rasterizando prato.
   */
  private aoTrocarAba = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.laco);
      this.dormindo = true;
    } else {
      this.acordar();
    }
  };

  private dimensionar(): void {
    const l = window.innerWidth;
    const a = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_MAX));
    this.renderer.setSize(l, a, false);
    this.canvas.style.width = `${l}px`;
    this.canvas.style.height = `${a}px`;
  }

  private acordar(): void {
    if (this.destruido || this.pausado || document.hidden) return;
    this.quadrosParados = 0;
    if (!this.dormindo) return;
    this.dormindo = false;
    this.ultimoQuadro = performance.now();
    this.laco = requestAnimationFrame(this.quadro);
  }

  private quadro = (agora: number) => {
    const dt = agora - this.ultimoQuadro;
    this.ultimoQuadro = agora;
    if (dt > 0) this.fps = this.fps * 0.9 + (1000 / dt) * 0.1;

    const desenhou = this.desenhar();

    // Dois quadros seguidos sem nada se mexendo e o laço dorme. Dois, e não um,
    // porque o quadro que zera a inércia ainda precisa ser desenhado.
    if (desenhou) this.quadrosParados = 0;
    else this.quadrosParados++;

    if (this.quadrosParados >= 2) {
      this.dormindo = true;
      return;
    }

    this.laco = requestAnimationFrame(this.quadro);
  };

  /** Devolve `true` se algo se moveu neste quadro. */
  private desenhar(): boolean {
    const alturaCss = window.innerHeight;

    // O canvas pode ter nascido com tamanho zero: acontece quando o palco é
    // construído antes do primeiro layout, e a aba de fundo relata viewport 0
    // até ser exibida. Sem esta conferência ele ficaria 0×0 para sempre, porque
    // `resize` não dispara ao voltar de um estado que nunca chegou a mudar —
    // e a tela ficaria vazia sem nada no console.
    if (this.renderer.domElement.width === 0 && alturaCss > 0) this.dimensionar();
    const giroDaRolagem = this.reduzido ? 0 : this.rolagem * GIRO_POR_PIXEL;

    // Limpa o canvas INTEIRO uma vez, com o recorte desligado. Sem isto, o
    // prato que saiu de cena deixa o rastro do último quadro na tela.
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.setScissorTest(true);
    this.renderer.info.reset();

    let mexeu = false;

    for (const v of this.vitrines) {
      if (!v.visivel || !v.alvo) continue;

      const r = v.el.getBoundingClientRect();
      if (r.bottom < -MARGEM_VISIVEL || r.top > alturaCss + MARGEM_VISIVEL) continue;
      if (r.width === 0 || r.height === 0) continue;

      if (Math.abs(v.inercia) > REPOUSO) {
        v.giroProprio += v.inercia;
        v.inercia *= ATRITO;
        mexeu = true;
      } else {
        v.inercia = 0;
      }

      // A rolagem entra como POSIÇÃO, não como velocidade: o prato volta
      // exatamente ao ângulo de antes se o cliente rolar de volta. É o que faz
      // parecer uma prateleira que ele gira com o dedo, e não uma animação
      // tocando por perto.
      const alvoGiro = giroDaRolagem + v.giroProprio;
      if (v.alvo.rotation.y !== alvoGiro) {
        v.alvo.rotation.y = alvoGiro;
        mexeu = true;
      }

      const aspecto = r.width / r.height;
      if (v.aspecto !== aspecto) enquadrar(v, aspecto);

      // WebGL conta a partir de baixo; `getBoundingClientRect` conta de cima.
      const base = alturaCss - r.bottom;
      this.renderer.setViewport(r.left, base, r.width, r.height);
      this.renderer.setScissor(r.left, base, r.width, r.height);
      this.renderer.render(v.cena, v.camera);
    }

    return mexeu;
  }

  /**
   * Arrasto no prato. Escuta na ÂNCORA e não no canvas — o canvas é
   * `pointer-events: none` de propósito, para não roubar o toque que abre o
   * item. Quem decide se o gesto é giro ou toque é a distância percorrida.
   */
  private ligarArrasto(v: Vitrine): void {
    let ativo = false;
    let ultimoX = 0;

    v.el.addEventListener('pointerdown', (e: PointerEvent) => {
      ativo = true;
      ultimoX = e.clientX;
      v.inercia = 0;
      v.el.setPointerCapture(e.pointerId);
    });

    v.el.addEventListener('pointermove', (e: PointerEvent) => {
      if (!ativo) return;
      const dx = e.clientX - ultimoX;
      ultimoX = e.clientX;
      v.giroProprio += dx * GIRO_POR_ARRASTO;
      v.inercia = dx * GIRO_POR_ARRASTO;
      this.acordar();
    });

    const soltar = (e: PointerEvent) => {
      if (!ativo) return;
      ativo = false;
      if (v.el.hasPointerCapture(e.pointerId)) v.el.releasePointerCapture(e.pointerId);
      this.acordar();
    };

    v.el.addEventListener('pointerup', soltar);
    v.el.addEventListener('pointercancel', soltar);
  }
}


/**
 * A caixa que envolve o prato, IGNORANDO o que não é comida.
 *
 * A sombra de contato é um plano bem mais largo que o prato — de propósito,
 * porque sombra dura na borda não parece sombra. Se ela entrar na conta, a
 * câmera recua para caber um disco de 30 cm e o hambúrguer de 11 cm chega ao
 * card do tamanho de uma azeitona. Foi o que aconteceu na primeira medição:
 * 7,6% do card pintado, com tudo tecnicamente "funcionando".
 *
 * Vale para modelo de verdade também: GLB exportado de ferramenta de captura
 * costuma vir com plano de chão, gizmo de luz ou caixa de referência junto.
 * O que não for comida se marca com `userData.auxiliar` e some da conta.
 */
function medir(alvo: THREE.Object3D): Medida {
  const caixa = new THREE.Box3();

  alvo.updateWorldMatrix(true, true);
  alvo.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.userData.auxiliar) return;
    caixa.expandByObject(o);
  });

  if (caixa.isEmpty()) caixa.setFromObject(alvo);

  const tamanho = caixa.getSize(new THREE.Vector3());
  const centro = caixa.getCenter(new THREE.Vector3());

  // O prato gira em torno de Y, então a planta é tratada como um DISCO de raio
  // igual à maior meia-extensão horizontal. Enquadrar pela caixa crua faria a
  // silhueta encolher e crescer durante o giro — o prato "respiraria" enquanto
  // o cliente rola a lista, que é exatamente o defeito que ninguém consegue
  // nomear mas todo mundo percebe.
  const raioHorizontal = Math.max(tamanho.x, tamanho.z) / 2;

  return {
    centro,
    meiaLargura: raioHorizontal,
    // Com a câmera a 30° acima do horizonte, a altura do prato entra na tela
    // encurtada por cos, e a profundidade da planta aparece como altura por
    // sen. Enquadrar pela esfera envolvente ignorava as duas coisas e recuava
    // como se o prato fosse uma bola — sobrava metade do card vazio.
    meiaAltura:
      raioHorizontal * Math.sin(INCLINACAO) + (tamanho.y / 2) * Math.cos(INCLINACAO),
    alcance: caixa.getBoundingSphere(new THREE.Sphere()).radius,
    base: tamanho.y / 2,
  };
}

/**
 * Põe a câmera à distância certa para o prato caber no card ATUAL.
 *
 * Card largo e baixo aperta na vertical; card estreito e alto aperta na
 * horizontal. Enquadrar só pelo campo de visão vertical — que é o que a
 * `PerspectiveCamera` guarda — funciona no primeiro caso e corta o prato no
 * segundo. Então mede-se os dois meios-ângulos e usa-se o MENOR: é ele que
 * decide onde o prato encosta na borda.
 */
function enquadrar(v: Vitrine, aspecto: number): void {
  if (!v.medida) return;

  v.aspecto = aspecto;
  v.camera.aspect = aspecto;

  const meioVertical = (v.camera.fov * Math.PI) / 360;
  const meioHorizontal = Math.atan(Math.tan(meioVertical) * aspecto);

  // Cada eixo pede uma distância; vence o que precisa de mais. Card largo e
  // baixo aperta na vertical, card estreito e alto aperta na horizontal — e
  // usar só o campo vertical, que é o que a `PerspectiveCamera` guarda, corta
  // o prato no segundo caso.
  const distancia =
    Math.max(
      v.medida.meiaLargura / Math.tan(meioHorizontal),
      v.medida.meiaAltura / Math.tan(meioVertical),
    ) * FOLGA;

  v.camera.position.set(
    0,
    distancia * Math.sin(INCLINACAO),
    distancia * Math.cos(INCLINACAO),
  );
  v.camera.lookAt(0, 0, 0);

  // Planos de corte colados no objeto: com `near` fixo em 1 cm e prato de 8 cm,
  // quase toda a precisão do buffer de profundidade iria para o vazio entre a
  // câmera e a comida, e as camadas do hambúrguer brigariam entre si.
  v.camera.near = Math.max(0.01, distancia - v.medida.alcance * 1.5);
  v.camera.far = distancia + v.medida.alcance * 3;
  v.camera.updateProjectionMatrix();
}


/**
 * A textura da sombra: gradiente radial, gerada uma vez por palco.
 *
 * Sombra de verdade custaria uma passada de render por prato — mapa de sombra,
 * outro alvo de textura, outra matriz. Isto custa 128×128 pixels desenhados uma
 * vez, e num prato visto de cima a 30° a diferença não aparece.
 */
function borraoDeSombra(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;

  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.Texture();

  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.40)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  return new THREE.CanvasTexture(c);
}
