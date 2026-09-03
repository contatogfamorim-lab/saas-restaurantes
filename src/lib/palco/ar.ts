'use client';

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * O prato na mesa, no tamanho que ele tem.
 *
 * O RECURSO É A ESCALA, NÃO A CÂMERA
 *
 * "Ver em 3D sobre a mesa" é bonito; a pergunta que ele responde é outra e é
 * muito mais útil: *isso serve duas pessoas?*. O cliente não consegue tirar do
 * texto se a porção é grande, e a foto mente por natureza — enquadramento
 * fechado faz hambúrguer de 9 cm parecer de 15. Um modelo em tamanho real
 * pousado na mesa dele responde em dois segundos.
 *
 * Por isso tudo aqui gira em torno de uma regra: NADA reescala o modelo. Ele é
 * autorado em metros, entra na cena em metros, e o cliente não pode redimensioná-lo
 * com dois dedos. Um AR que deixa esticar o prato é uma demonstração de
 * tecnologia; um que não deixa é uma informação.
 *
 * DOIS MUNDOS QUE NÃO CONVERSAM
 *
 * Android/Chrome tem WebXR: a sessão roda DENTRO da página, com detecção de
 * plano por `hit-test`, e é o que este arquivo implementa.
 *
 * iPhone/Safari não tem WebXR. O caminho é o AR Quick Look, que é um
 * visualizador do SISTEMA: um `<a rel="ar" href="prato.usdz">` entrega o
 * arquivo ao iOS e a página sai de cena. Exige USDZ — outro arquivo, outro
 * formato, gerado por ferramenta USD que não roda no navegador. O caminho está
 * ligado aqui e espera o arquivo.
 *
 * A consequência prática de o Quick Look sair do navegador: o carrinho tem que
 * sobreviver à ida e à volta. Sobrevive — `use-cart.ts` guarda no
 * `localStorage`.
 */

export type SuporteDeAr = 'webxr' | 'quicklook' | 'nenhum';

/**
 * O que este aparelho consegue fazer. Consultado antes de mostrar o botão:
 * botão que não funciona é pior que botão nenhum.
 */
export async function suporteDeAr(): Promise<SuporteDeAr> {
  if (typeof navigator === 'undefined') return 'nenhum';

  try {
    if (await navigator.xr?.isSessionSupported('immersive-ar')) return 'webxr';
  } catch {
    // `isSessionSupported` rejeita em contexto não seguro, entre outros. Não é
    // erro: é a resposta "não".
  }

  // `relList.supports('ar')` é como o Safari anuncia o Quick Look. Nenhum outro
  // navegador responde `true`, então serve de detecção de recurso e não de
  // aparelho.
  const a = document.createElement('a');
  if (a.relList?.supports?.('ar')) return 'quicklook';

  return 'nenhum';
}

export interface PratoParaAr {
  /** GLB do nível hero, em metros, com a origem na base. */
  glb: string;
  /** USDZ equivalente, para o Quick Look do iOS. */
  usdz?: string;
  nome: string;
}

/**
 * Entrega o prato ao visualizador do sistema (iOS).
 *
 * `allowsContentScaling=0` é o equivalente do Quick Look ao `ar-scale="fixed"`:
 * sem ele o cliente estica o prato com dois dedos e a informação de tamanho —
 * a única razão de o recurso existir — vai embora.
 */
export function abrirQuickLook(prato: PratoParaAr): void {
  if (!prato.usdz) throw new Error(`sem USDZ para ${prato.nome}`);

  const a = document.createElement('a');
  a.rel = 'ar';
  a.href = `${prato.usdz}#allowsContentScaling=0`;

  // O Quick Look EXIGE uma <img> filha; sem ela o Safari trata o link como
  // navegação comum e baixa o arquivo em vez de abrir o visualizador.
  a.appendChild(document.createElement('img'));

  a.click();
}

/**
 * A sessão WebXR: retículo procurando a mesa, toque para pousar o prato.
 *
 * Renderer PRÓPRIO, e não o do palco. O palco desenha trinta recortes de tela
 * num laço que ele mesmo controla; o WebXR exige `setAnimationLoop` e o quadro
 * vindo do compositor do aparelho. São dois regimes incompatíveis, e forçar um
 * só renderer a servir aos dois custaria mais complexidade do que o contexto
 * WebGL extra que este arquivo abre — e que vive só enquanto a sessão dura.
 */
export class SessaoNaMesa {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly cena = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly reticulo: THREE.Mesh;

  private sessao: XRSession | null = null;
  private fonteDeToque: XRHitTestSource | null = null;
  private espacoLocal: XRReferenceSpace | null = null;

  private prato: THREE.Object3D | null = null;
  private pousado = false;

  /** Chamado quando o prato encosta na mesa, para a interface reagir. */
  aoPousar: (() => void) | null = null;
  aoEncerrar: (() => void) | null = null;

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.xr.enabled = true;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const sala = new RoomEnvironment();
    this.cena.environment = pmrem.fromScene(sala, 0.04).texture;
    sala.dispose();
    pmrem.dispose();

    const chave = new THREE.DirectionalLight(0xffffff, 1.4);
    chave.position.set(1, 3, 1);
    this.cena.add(chave);

    // Anel deitado de 7 cm: some sob um prato de 26 cm em vez de disputar
    // atenção com ele, e é grande o bastante para se ver de pé.
    this.reticulo = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.07, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    );
    this.reticulo.matrixAutoUpdate = false;
    this.reticulo.visible = false;
    this.cena.add(this.reticulo);
  }

  /**
   * Abre a câmera e começa a procurar a mesa.
   *
   * `sobreposicao` é o elemento da página que continua visível por cima do
   * vídeo — onde ficam o nome do prato, a instrução e o botão de sair. Sem ele
   * a sessão vira uma tela sem saída no Android.
   */
  async abrir(modelo: THREE.Object3D, sobreposicao: HTMLElement): Promise<void> {
    const sessao = await navigator.xr!.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: sobreposicao },
    });

    this.sessao = sessao;
    await this.renderer.xr.setSession(sessao);

    // ORIGEM NA BASE, SEM TOCAR NA ESCALA.
    //
    // A escala é sagrada — é o recurso inteiro. Mas a ORIGEM não: modelo com o
    // pivô no centro geométrico afunda meio prato na mesa, e modelo com o pivô
    // deslocado pousa ao lado do ponto tocado. Então mede-se a caixa e move-se
    // o objeto para que o fundo dela caia em y = 0 e o eixo passe pelo centro.
    const caixa = new THREE.Box3().setFromObject(modelo);
    const centro = caixa.getCenter(new THREE.Vector3());
    modelo.position.set(-centro.x, -caixa.min.y, -centro.z);

    this.prato = new THREE.Group();
    this.prato.add(modelo);
    this.prato.visible = false;
    this.cena.add(this.prato);

    const visor = await sessao.requestReferenceSpace('viewer');
    this.fonteDeToque = (await sessao.requestHitTestSource?.({ space: visor })) ?? null;
    this.espacoLocal = await sessao.requestReferenceSpace('local');

    sessao.addEventListener('select', this.aoTocar);
    sessao.addEventListener('end', this.aoTerminar);

    this.renderer.setAnimationLoop(this.quadro);
  }

  /** Tira o prato da mesa para escolher outro lugar. */
  reposicionar(): void {
    this.pousado = false;
    if (this.prato) this.prato.visible = false;
  }

  async fechar(): Promise<void> {
    await this.sessao?.end();
  }

  // ---------------------------------------------------------------------------

  private aoTocar = () => {
    if (!this.reticulo.visible || !this.prato) return;

    // A pose do retículo carrega posição E orientação do plano. Copiar a matriz
    // inteira é o que faz o prato acompanhar uma mesa que não está perfeitamente
    // nivelada — o que é toda mesa de restaurante.
    this.prato.position.setFromMatrixPosition(this.reticulo.matrix);
    this.prato.visible = true;
    this.pousado = true;
    this.reticulo.visible = false;
    this.aoPousar?.();
  };

  private aoTerminar = () => {
    this.renderer.setAnimationLoop(null);
    this.fonteDeToque?.cancel?.();
    this.fonteDeToque = null;
    this.sessao = null;
    this.renderer.dispose();
    this.aoEncerrar?.();
  };

  private quadro = (_tempo: number, frame?: XRFrame) => {
    if (frame && !this.pousado && this.fonteDeToque && this.espacoLocal) {
      const toques = frame.getHitTestResults(this.fonteDeToque);

      if (toques.length > 0) {
        const pose = toques[0].getPose(this.espacoLocal);
        if (pose) {
          this.reticulo.visible = true;
          this.reticulo.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        // Sem plano encontrado o retículo SOME, em vez de ficar parado no
        // último lugar visto. Retículo mentiroso faz o cliente tocar e o prato
        // aparecer a um metro de onde ele queria.
        this.reticulo.visible = false;
      }
    }

    this.renderer.render(this.cena, this.camera);
  };
}
