'use client';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/**
 * Busca modelos pela rede, na ordem em que o cliente vai vê-los.
 *
 * O CARDÁPIO NÃO É UMA CENA, É UMA FILA
 *
 * Trinta pratos baixados de uma vez entopem a conexão e chegam todos tarde. O
 * que importa é o prato embaixo do polegar AGORA: quem está no centro da tela é
 * buscado primeiro, quem está a dez cards de distância espera, e quem saiu de
 * cena é abandonado no meio do download. O `fetch` é feito à mão, em vez de usar
 * o `load` do Three, exatamente por causa disso: `AbortController` e contagem de
 * bytes só existem deste lado.
 *
 * A urgência é RELIDA a cada rodada, não fixada na hora do pedido. O cliente
 * rola rápido e muda de ideia; uma fila que decidiu a ordem no início entrega o
 * cardápio de trás para frente.
 *
 * A UNIDADE É A URL, NÃO O PEDIDO
 *
 * Esta foi a primeira versão errada. Cada card pedia por conta própria, e o
 * cache só era preenchido quando o download TERMINAVA — então trinta cards
 * mostrando três pratos diferentes baixaram 366 KB em vez de 37 KB, porque os
 * pedidos simultâneos da mesma URL saíram todos antes do primeiro chegar.
 *
 * Agora o carregador raciocina por ARQUIVO. Cada URL tem uma tarefa, e os cards
 * interessados nela são um conjunto: a urgência da tarefa é a do interessado
 * mais aflito, e o download só é abortado quando o ÚLTIMO deles desiste. Um card
 * sair de cena não pode cancelar o prato que outro ainda está esperando.
 *
 * DOIS NÍVEIS
 *
 * `card` é o que roda na lista — leve, feito para 100 a 300 px de tela. `hero` é
 * o que abre em tela cheia e vai para o AR. O card nunca paga pelo hero: são
 * arquivos separados, e o segundo só é pedido quando o dedo encosta.
 *
 * O QUE ISTO CUSTA NA CSP
 *
 * O decodificador Draco é WebAssembly, e WASM é governado pelo `script-src`.
 * Sem `wasm-unsafe-eval` em `src/proxy.ts`, todo modelo comprimido falha ao
 * decodificar — silenciosamente, do ponto de vista de quem olha a tela.
 */

/** Quantos downloads simultâneos. Mais que isto e todos chegam tarde juntos. */
const SIMULTANEOS = 3;

/** Urgência de quem não deve ser baixado agora. */
const NUNCA = Infinity;

type Urgencia = () => number;

interface Tarefa {
  url: string;
  /** Quem está esperando este arquivo. Vazio = ninguém mais quer. */
  interessados: Set<Urgencia>;
  controlador: AbortController;
  /** O objeto original. Cada interessado recebe um clone dele. */
  original: Promise<THREE.Group>;
  resolver: (cena: THREE.Group) => void;
  rejeitar: (erro: unknown) => void;
  baixando: boolean;
}

export class Carregador {
  private readonly gltf = new GLTFLoader();
  private readonly draco = new DRACOLoader();

  /** Uma tarefa por URL, viva enquanto alguém a quiser. */
  private readonly tarefas = new Map<string, Tarefa>();

  private emVoo = 0;
  private destruido = false;

  /** Bytes que de fato desceram da rede. Zero para o que veio do cache. */
  bytes = 0;

  constructor() {
    // Servido de `public/draco/`, não de CDN: a CSP é `default-src 'self'`.
    this.draco.setDecoderPath('/draco/');
    this.draco.setDecoderConfig({ type: 'wasm' });
    this.gltf.setDRACOLoader(this.draco);
  }

  /**
   * Manifesta interesse num modelo. A promessa resolve quando o arquivo chega.
   *
   * `desistir()` remove este interessado. Se for o último, o download em curso
   * é abortado; se ainda houver outro esperando, ele continua.
   */
  pedir(
    url: string,
    urgencia: Urgencia,
  ): { pronto: Promise<THREE.Group>; desistir: () => void } {
    const tarefa = this.tarefas.get(url) ?? this.criar(url);
    tarefa.interessados.add(urgencia);

    // Clone COMPARTILHA geometria e material com o original — o que é caro (o
    // buffer na GPU, o programa de shader) fica uma vez só na memória, mesmo com
    // o mesmo prato em vinte cards.
    const pronto = tarefa.original.then((cena) => cena.clone());

    // A promessa devolvida a quem desistiu é rejeitada, e ninguém a observa.
    // Sem isto o navegador reporta rejeição não tratada a cada card que rola
    // para fora da tela.
    pronto.catch(() => {});

    this.girar();

    return {
      pronto,
      desistir: () => {
        tarefa.interessados.delete(urgencia);
        if (tarefa.interessados.size > 0) return;

        tarefa.controlador.abort();
        // Só some do mapa se ainda não chegou: arquivo já baixado continua
        // valendo como cache para quem pedir depois.
        if (tarefa.baixando || !this.chegou(tarefa)) this.tarefas.delete(url);
      },
    };
  }

  destruir(): void {
    this.destruido = true;
    for (const t of this.tarefas.values()) t.controlador.abort();
    this.tarefas.clear();
    this.draco.dispose();
  }

  // ---------------------------------------------------------------------------

  private criar(url: string): Tarefa {
    let resolver!: (cena: THREE.Group) => void;
    let rejeitar!: (erro: unknown) => void;

    const original = new Promise<THREE.Group>((res, rej) => {
      resolver = res;
      rejeitar = rej;
    });
    original.catch(() => {});

    const tarefa: Tarefa = {
      url,
      interessados: new Set(),
      controlador: new AbortController(),
      original,
      resolver,
      rejeitar,
      baixando: false,
    };

    this.tarefas.set(url, tarefa);
    return tarefa;
  }

  /** Já resolveu? Marcado por `baixar`, para não interrogar a promessa. */
  private readonly concluidas = new Set<string>();

  private chegou(t: Tarefa): boolean {
    return this.concluidas.has(t.url);
  }

  private girar(): void {
    while (!this.destruido && this.emVoo < SIMULTANEOS) {
      const tarefa = this.proxima();
      if (!tarefa) return;

      tarefa.baixando = true;
      this.emVoo++;

      void this.baixar(tarefa).finally(() => {
        this.emVoo--;
        tarefa.baixando = false;
        this.girar();
      });
    }
  }

  /** A tarefa pendente cujo interessado mais aflito está mais perto da tela. */
  private proxima(): Tarefa | null {
    let escolhida: Tarefa | null = null;
    let menor = NUNCA;

    for (const t of this.tarefas.values()) {
      if (t.baixando || this.concluidas.has(t.url)) continue;
      if (t.controlador.signal.aborted) continue;

      // A tarefa vale o que vale o interessado mais aflito: um card no centro
      // da tela puxa o arquivo para a frente da fila mesmo que outros cinco
      // cards distantes também o queiram.
      let u = NUNCA;
      for (const urgencia of t.interessados) u = Math.min(u, urgencia());

      if (u < menor) {
        menor = u;
        escolhida = t;
      }
    }

    return menor === NUNCA ? null : escolhida;
  }

  private async baixar(t: Tarefa): Promise<void> {
    try {
      const resposta = await fetch(t.url, { signal: t.controlador.signal });
      if (!resposta.ok) throw new Error(`${resposta.status} em ${t.url}`);

      const dados = await resposta.arrayBuffer();
      this.bytes += dados.byteLength;

      // O caminho base fica vazio: os GLB são autocontidos, sem textura solta ao
      // lado. Se um dia deixarem de ser, é aqui que se resolve a URL relativa —
      // e não no servidor.
      const gltf = await this.gltf.parseAsync(dados, '');

      this.concluidas.add(t.url);
      t.resolver(gltf.scene);
    } catch (erro) {
      this.tarefas.delete(t.url);
      t.rejeitar(erro);
    }
  }
}
