'use client';

import * as THREE from 'three';

/**
 * Pratos de mentira, para o cardápio ter o que mostrar antes de existir
 * digitalização.
 *
 * O que este arquivo responde é UMA pergunta: como fica um cardápio inteiro em
 * 3D, rolando? Para isso não importa se o hambúrguer é fotorrealista — importa
 * que cada item seja RECONHECÍVEL e DIFERENTE do vizinho. Um cardápio em que
 * doze burgers, cinco bebidas e quatro sobremesas aparecem como o mesmo objeto
 * não mostra nada sobre o produto final; mostra só que o renderizador funciona,
 * o que já sabíamos.
 *
 * Daí a lista de receitas ser por TIPO DE COMIDA e não por categoria: copo,
 * garrafa, cesto de fritas, anéis, bolinho, fatia. E daí cada receita aceitar
 * uma VARIANTE — o cardápio tem doze burgers, e doze cópias do mesmo modelo
 * seria o mesmo problema um nível abaixo.
 *
 * O número de segmentos fica no controle (`detalhe`), então a mesma receita
 * serve para o modelo leve do card e para o pesado do AR, e dá para medir o
 * custo de cada um mexendo num número.
 *
 * TUDO EM METROS, NO TAMANHO REAL
 *
 * Prato raso de 26 cm, copo de 8, long neck de 6 por 22 de altura. É a mesma
 * escala que o AR exige, e manter uma escala só desde o primeiro dia é como se
 * evita o hambúrguer de 24 metros na calçada. A origem de cada prato fica na
 * BASE, centrada — é onde o AR precisa que ela esteja para o objeto pousar na
 * mesa em vez de afundar meio dedo nela.
 *
 * Nenhuma receita traz sombra: isso é do palco, que mede o objeto carregado e
 * põe o disco na escala certa. Modelo é comida.
 */

export interface PratoDeTeste {
  objeto: THREE.Object3D;
  triangulos: number;
}

/** Escala de segmentos. 1 = card leve; 4 = modelo hero. */
export type Detalhe = 1 | 2 | 4;

function seg(base: number, detalhe: Detalhe): number {
  return Math.max(8, Math.round(base * detalhe));
}

// ── MATERIAIS ────────────────────────────────────────────────────────────────

function fosco(cor: number, aspereza = 0.75): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: cor, roughness: aspereza, metalness: 0 });
}

/** Molho, glacê, gordura: o que faz comida parecer comida é o verniz por cima. */
function envernizado(cor: number, aspereza = 0.35): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: cor,
    roughness: aspereza,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.25,
  });
}

function louca(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf6f4f0,
    roughness: 0.18,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,

    // AS DUAS FACES, e não é preciosismo.
    //
    // O prato é uma casca sem espessura, gerada por revolução de um perfil. No
    // trecho do fundo — plano, y constante do centro até 65% do raio — o
    // `LatheGeometry` emite as normais apontando para BAIXO. Com o descarte de
    // faces traseiras ligado (o padrão), esse disco simplesmente não é
    // desenhado: aparece um buraco preto no meio do prato, com a aba branca
    // intacta em volta. Passei um bom tempo culpando a sombra por isso.
    side: THREE.DoubleSide,
  });
}

/**
 * Vidro barato: transparência simples, sem refração.
 *
 * `transmission` do `MeshPhysicalMaterial` daria vidro de verdade e custaria
 * uma passada extra de renderização POR OBJETO — num cardápio com cinco bebidas
 * visíveis ao mesmo tempo, é o tipo de coisa que derruba o celular do cliente.
 * Opacidade e um reflexo forte enganam bem o suficiente num copo de 8 cm.
 */
function vidro(cor = 0xdfe9ee, opacidade = 0.32): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: cor,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: opacidade,
    side: THREE.DoubleSide,
  });
}

// ── LOUÇA E RECIPIENTES ──────────────────────────────────────────────────────

/** Prato raso — a louça mais comum de restaurante. */
function pratoRaso(detalhe: Detalhe, diametro = 0.26): THREE.Mesh {
  const r = diametro / 2;
  const perfil: THREE.Vector2[] = [];
  const passos = seg(24, detalhe);

  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    // Fundo plano até 65% do raio, depois a aba subindo.
    const x = r * t;
    const y = t < 0.65 ? 0.004 : 0.004 + Math.pow((t - 0.65) / 0.35, 1.7) * 0.018;
    perfil.push(new THREE.Vector2(x, y));
  }
  perfil.push(new THREE.Vector2(r, 0));
  perfil.push(new THREE.Vector2(r * 0.55, 0));

  return new THREE.Mesh(new THREE.LatheGeometry(perfil, seg(48, detalhe)), louca());
}

/** Cumbuca / tigela funda. */
function cumbuca(detalhe: Detalhe, diametro: number, altura: number, cor?: number): THREE.Mesh {
  const r = diametro / 2;
  const perfil: THREE.Vector2[] = [];
  const passos = seg(20, detalhe);

  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    perfil.push(new THREE.Vector2(r * (0.4 + 0.6 * Math.pow(t, 0.75)), t * altura));
  }

  const material = cor === undefined ? louca() : fosco(cor, 0.85);
  material.side = THREE.DoubleSide;
  return new THREE.Mesh(new THREE.LatheGeometry(perfil, seg(44, detalhe)), material);
}

/** Copo reto de bar. */
function copoDeVidro(detalhe: Detalhe, diametro: number, altura: number): THREE.Mesh {
  const r = diametro / 2;
  const perfil: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r * 0.82, 0),
    new THREE.Vector2(r * 0.88, altura * 0.12),
    new THREE.Vector2(r, altura),
  ];
  return new THREE.Mesh(new THREE.LatheGeometry(perfil, seg(40, detalhe)), vidro());
}

// ── RECEITAS ─────────────────────────────────────────────────────────────────

/**
 * Hambúrguer, com a pilha inteira variando — não só a cor.
 *
 * Doze dos trinta itens do cardápio são burgers, e trocar o tom da carne não
 * distingue nada num card: à distância de leitura, cinco cilindros marrons são
 * o mesmo objeto. O que separa um do outro é a SILHUETA — quantas carnes,
 * altura da pilha, se tem tiras de bacon saindo pelas bordas, se tem cogumelo
 * em cima. É por isso que cada variante mexe na construção e não na paleta.
 */
function hamburguer(detalhe: Detalhe, variante: number): THREE.Object3D {
  const g = new THREE.Group();
  const rad = seg(40, detalhe);

  const receitas = [
    { carnes: 1, cor: 0x4a2c1c, escala: 1, extra: 'nenhum' }, // clássico
    { carnes: 2, cor: 0x4a2c1c, escala: 1, extra: 'nenhum' }, // duplo
    { carnes: 1, cor: 0xa9702f, escala: 1, extra: 'nenhum' }, // frango empanado
    { carnes: 1, cor: 0x8a7a45, escala: 1, extra: 'nenhum' }, // grão-de-bico
    { carnes: 1, cor: 0x4a2c1c, escala: 1, extra: 'bacon' }, // cheddar bacon
    { carnes: 1, cor: 0x4a2c1c, escala: 1, extra: 'cogumelo' }, // cogumelos
    { carnes: 3, cor: 0x4a2c1c, escala: 1, extra: 'nenhum' }, // trinca
    { carnes: 1, cor: 0x4a2c1c, escala: 0.76, extra: 'nenhum' }, // kids
  ] as const;

  const receita = receitas[variante % receitas.length];
  const r = 0.055 * receita.escala;

  let y = 0.011;
  const pilha: Array<[number, number, THREE.Material]> = [];

  pilha.push([r * 0.98, 0.022, fosco(0xd4a052, 0.7)]); // base do pão

  for (let i = 0; i < receita.carnes; i++) {
    pilha.push([r, 0.018, fosco(receita.cor, 0.85)]);
    // Queijo entre as carnes e por cima da última: é o que dá a leitura de
    // "duplo" e "trinca" à distância de um card de cardápio.
    pilha.push([r * 0.94, 0.007, envernizado(0xd9c04a, 0.28)]);
  }

  pilha.push([r * 1.06, 0.006, fosco(0x6b9c3f, 0.8)]); // alface
  pilha.push([r * 0.92, 0.007, envernizado(0xb8342a, 0.3)]); // tomate

  for (const [raio, altura, mat] of pilha) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(raio, raio * 0.97, altura, rad), mat);
    m.position.y = y + altura / 2;
    y += altura;
    g.add(m);
  }

  // Bacon: tiras que ESCAPAM pela borda. É o detalhe que se enxerga no card —
  // dentro da pilha, bacon é mais uma faixa marrom entre outras.
  if (receita.extra === 'bacon') {
    const tira = new THREE.BoxGeometry(r * 2.5, 0.004, 0.012);
    const mat = fosco(0x8f3a24, 0.6);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(tira, mat);
      m.position.set(0, y - 0.012 + i * 0.004, (i - 1) * 0.016);
      m.rotation.set(0.06 * (i - 1), 0.4 * i, 0.05);
      g.add(m);
    }
  }

  if (receita.extra === 'cogumelo') {
    const chapeu = new THREE.SphereGeometry(0.014, rad, seg(12, detalhe), 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = fosco(0x6b5240, 0.8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const m = new THREE.Mesh(chapeu, mat);
      m.scale.y = 0.6;
      m.position.set(Math.cos(a) * r * 0.5, y - 0.002, Math.sin(a) * r * 0.5);
      g.add(m);
    }
  }

  const pao = new THREE.SphereGeometry(r, rad, seg(24, detalhe), 0, Math.PI * 2, 0, Math.PI / 2);
  const topo = new THREE.Mesh(pao, fosco(0xc98b3f, 0.62));
  topo.scale.y = 0.72;
  topo.position.y = y;
  g.add(topo);

  return g;
}

function pizza(detalhe: Detalhe): THREE.Object3D {
  const g = new THREE.Group();
  const rad = seg(64, detalhe);
  const r = 0.15;

  const massa = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.96, 0.012, rad),
    fosco(0xd9a960, 0.8),
  );
  massa.position.y = 0.006;
  g.add(massa);

  const queijo = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.005, rad),
    envernizado(0xe8c46a, 0.34),
  );
  queijo.position.y = 0.014;
  g.add(queijo);

  const calabresa = new THREE.CylinderGeometry(0.016, 0.016, 0.004, seg(20, detalhe));
  const matCalabresa = envernizado(0xa32b22, 0.4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const d = i % 2 === 0 ? r * 0.55 : r * 0.28;
    const m = new THREE.Mesh(calabresa, matCalabresa);
    m.position.set(Math.cos(a) * d, 0.018, Math.sin(a) * d);
    g.add(m);
  }

  return g;
}

/** Sopa ou caldo na cumbuca. */
function caldo(detalhe: Detalhe): THREE.Object3D {
  const g = new THREE.Group();
  const r = 0.08;

  g.add(cumbuca(detalhe, 0.16, 0.055));

  // Superfície do caldo logo abaixo da borda. Sem ela a tigela lê como objeto
  // de cerâmica, não como comida.
  const superficie = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.002, seg(44, detalhe)),
    envernizado(0xb5601f, 0.12),
  );
  superficie.position.y = 0.046;
  g.add(superficie);

  const bola = new THREE.SphereGeometry(0.012, seg(20, detalhe), seg(14, detalhe));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const m = new THREE.Mesh(bola, fosco(0xe7d9b8, 0.7));
    m.position.set(Math.cos(a) * r * 0.42, 0.05, Math.sin(a) * r * 0.42);
    m.scale.y = 0.6;
    g.add(m);
  }

  return g;
}

/**
 * Porção de fritas na cumbuca. Variante 0 é palito, 1 é rústica em gomos.
 *
 * Os palitos são posicionados por um gerador determinístico, e não ao acaso:
 * modelo que muda de arranjo a cada carregamento é modelo que não dá para
 * comparar entre duas versões do código.
 */
function fritas(detalhe: Detalhe, variante: number): THREE.Object3D {
  const g = new THREE.Group();
  const rustica = variante % 2 === 1;

  g.add(cumbuca(detalhe, 0.15, 0.05, 0x8a5a3b));

  const palito = rustica
    ? new THREE.BoxGeometry(0.022, 0.012, 0.03)
    : new THREE.BoxGeometry(0.009, 0.009, 0.075);
  const mat = fosco(rustica ? 0xd8a33f : 0xe3b754, 0.68);

  const quantos = rustica ? 14 : 22;
  for (let i = 0; i < quantos; i++) {
    // Espiral determinística: cobre a boca da cumbuca sem sortear nada.
    const t = i / quantos;
    const a = t * Math.PI * 6.2;
    const d = 0.048 * Math.sqrt(t);

    const m = new THREE.Mesh(palito, mat);
    m.position.set(Math.cos(a) * d, 0.045 + t * 0.03, Math.sin(a) * d);
    m.rotation.set(rustica ? 0.2 : -0.9 + t * 0.5, a, rustica ? t * 2 : 0.35);
    g.add(m);
  }

  return g;
}

/** Anéis de cebola empilhados no prato. */
function aneis(detalhe: Detalhe): THREE.Object3D {
  const g = new THREE.Group();
  g.add(pratoRaso(detalhe, 0.24));

  const anel = new THREE.TorusGeometry(0.03, 0.011, seg(10, detalhe), seg(22, detalhe));
  const mat = fosco(0xd8a44e, 0.7);

  // Torre inclinada, que é como anel de cebola chega à mesa. Deitados no prato
  // eles somem no card: de cima, um toro deitado é indistinguível de uma
  // rodela de qualquer coisa.
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(anel, mat);
    m.position.set(-0.02 + i * 0.008, 0.014 + i * 0.016, 0);
    m.rotation.set(Math.PI / 2 - 0.35, 0, 0.1 * i);
    g.add(m);
  }

  return g;
}

/** Pedaços empanados no prato — isca, passarinho, nugget. */
function empanados(detalhe: Detalhe, variante: number): THREE.Object3D {
  const g = new THREE.Group();
  g.add(pratoRaso(detalhe, 0.24));

  const formas = [
    new THREE.BoxGeometry(0.045, 0.016, 0.022), // isca
    new THREE.SphereGeometry(0.019, seg(16, detalhe), seg(12, detalhe)), // passarinho
    new THREE.CylinderGeometry(0.018, 0.018, 0.012, seg(10, detalhe)), // nugget
  ];
  const forma = formas[variante % formas.length];
  const mat = fosco(0xcf9440, 0.72);

  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const a = t * Math.PI * 5.4;
    const d = 0.07 * Math.sqrt(t);

    const m = new THREE.Mesh(forma, mat);
    m.position.set(Math.cos(a) * d, 0.012 + (i % 3) * 0.012, Math.sin(a) * d);
    m.rotation.set(0.2 + t, a, t * 0.8);
    g.add(m);
  }

  return g;
}

/**
 * Bebida em copo. Variante escolhe a cor do líquido e se tem colarinho.
 *
 * O colarinho do chopp é o detalhe que faz a diferença: sem ele, cerveja e
 * suco de laranja são o mesmo cilindro âmbar.
 */
function bebida(detalhe: Detalhe, variante: number): THREE.Object3D {
  const g = new THREE.Group();

  const receitas = [
    { cor: 0xd9a02b, espuma: true, altura: 0.15, diametro: 0.075 }, // chopp
    { cor: 0x3b1f14, espuma: false, altura: 0.13, diametro: 0.07 }, // refrigerante
    { cor: 0xe8901c, espuma: false, altura: 0.13, diametro: 0.07 }, // suco
    { cor: 0xd8e8c8, espuma: true, altura: 0.13, diametro: 0.07 }, // limonada suíça
  ];
  const r = receitas[variante % receitas.length];
  const raio = r.diametro / 2;

  g.add(copoDeVidro(detalhe, r.diametro, r.altura));

  const nivel = r.espuma ? r.altura * 0.78 : r.altura * 0.88;
  const liquido = new THREE.Mesh(
    new THREE.CylinderGeometry(raio * 0.93, raio * 0.8, nivel, seg(36, detalhe)),
    envernizado(r.cor, 0.15),
  );
  liquido.position.y = nivel / 2 + 0.004;
  g.add(liquido);

  if (r.espuma) {
    const espuma = new THREE.Mesh(
      new THREE.CylinderGeometry(raio * 0.95, raio * 0.93, r.altura * 0.16, seg(36, detalhe)),
      fosco(0xfaf6ec, 0.9),
    );
    espuma.position.y = nivel + r.altura * 0.08;
    g.add(espuma);
  }

  return g;
}

/** Garrafa — água mineral, long neck. */
function garrafa(detalhe: Detalhe, variante: number): THREE.Object3D {
  const rad = seg(32, detalhe);
  const longNeck = variante % 2 === 1;

  const altura = longNeck ? 0.22 : 0.24;
  const raio = longNeck ? 0.031 : 0.034;

  const perfil: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(raio * 0.9, 0),
    new THREE.Vector2(raio, altura * 0.06),
    new THREE.Vector2(raio, altura * 0.55),
    new THREE.Vector2(raio * 0.55, altura * 0.72),
    new THREE.Vector2(raio * 0.34, altura * 0.82),
    new THREE.Vector2(raio * 0.34, altura),
    new THREE.Vector2(raio * 0.38, altura),
  ];

  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(
      new THREE.LatheGeometry(perfil, rad),
      vidro(longNeck ? 0x4a3a18 : 0xdfeef2, longNeck ? 0.55 : 0.28),
    ),
  );

  // Conteúdo: um cilindro por dentro, mais opaco. É o que diferencia garrafa
  // cheia de garrafa vazia num card de 230 px.
  const conteudo = new THREE.Mesh(
    new THREE.CylinderGeometry(raio * 0.9, raio * 0.85, altura * 0.5, rad),
    envernizado(longNeck ? 0xc98a22 : 0xcfe6ee, 0.15),
  );
  conteudo.position.y = altura * 0.29;
  g.add(conteudo);

  const tampa = new THREE.Mesh(
    new THREE.CylinderGeometry(raio * 0.4, raio * 0.4, altura * 0.05, rad),
    fosco(longNeck ? 0xb8332a : 0x2f6fb5, 0.4),
  );
  tampa.position.y = altura * 0.99;
  g.add(tampa);

  return g;
}

/** Milkshake: copo alto, chantilly e canudo. */
function milkshake(detalhe: Detalhe): THREE.Object3D {
  const g = new THREE.Group();
  const rad = seg(36, detalhe);
  const raio = 0.038;
  const altura = 0.16;

  g.add(copoDeVidro(detalhe, raio * 2, altura));

  const massa = new THREE.Mesh(
    new THREE.CylinderGeometry(raio * 0.93, raio * 0.78, altura * 0.82, rad),
    envernizado(0xd9b483, 0.3),
  );
  massa.position.y = altura * 0.41 + 0.004;
  g.add(massa);

  // Chantilly: três esferas achatadas de raio decrescente. Espiral de verdade
  // custaria uma geometria por tubo e não muda nada num card.
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(raio * (0.95 - i * 0.22), rad, seg(14, detalhe)),
      fosco(0xfdf8ef, 0.85),
    );
    s.scale.y = 0.55;
    s.position.y = altura * 0.86 + i * raio * 0.4;
    g.add(s);
  }

  const canudo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.09, seg(10, detalhe)),
    fosco(0xc4392f, 0.5),
  );
  canudo.position.set(raio * 0.4, altura * 1.05, 0);
  canudo.rotation.z = 0.24;
  g.add(canudo);

  return g;
}

/** Bolinho quente com bola de sorvete — petit gateau, brownie. */
function sobremesaQuente(detalhe: Detalhe, variante: number): THREE.Object3D {
  const g = new THREE.Group();
  const rad = seg(28, detalhe);
  g.add(pratoRaso(detalhe, 0.22));

  const quadrado = variante % 2 === 1;
  const bolo = quadrado
    ? new THREE.BoxGeometry(0.075, 0.035, 0.075)
    : new THREE.CylinderGeometry(0.038, 0.034, 0.042, rad);

  const m = new THREE.Mesh(bolo, fosco(0x3a2118, 0.78));
  m.position.set(-0.03, 0.026, 0);
  g.add(m);

  const sorvete = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, rad, seg(16, detalhe)),
    fosco(0xf6efdc, 0.88),
  );
  sorvete.position.set(0.048, 0.036, 0.006);
  g.add(sorvete);

  // Calda escorrendo: disco fino e envernizado sob o bolo.
  const calda = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.062, 0.003, rad),
    envernizado(0x2a140d, 0.2),
  );
  calda.position.y = 0.007;
  g.add(calda);

  return g;
}

/** Fatia de torta — cheesecake. */
function fatia(detalhe: Detalhe): THREE.Object3D {
  const g = new THREE.Group();
  const rad = seg(24, detalhe);
  g.add(pratoRaso(detalhe, 0.22));

  const abertura = Math.PI / 3.4;

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.014, rad, 1, false, 0, abertura),
    fosco(0xa97440, 0.8),
  );
  base.position.y = 0.013;
  g.add(base);

  const creme = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.042, rad, 1, false, 0, abertura),
    fosco(0xf7f0dc, 0.7),
  );
  creme.position.y = 0.041;
  g.add(creme);

  const cobertura = new THREE.Mesh(
    new THREE.CylinderGeometry(0.076, 0.076, 0.008, rad, 1, false, 0, abertura),
    envernizado(0x9d1f38, 0.2),
  );
  cobertura.position.y = 0.066;
  g.add(cobertura);

  return g;
}

// ── CATÁLOGO ─────────────────────────────────────────────────────────────────

type Receita = (detalhe: Detalhe, variante: number) => THREE.Object3D;

const RECEITAS: Record<string, Receita> = {
  burger: hamburguer,
  pizza: (d) => pizza(d),
  caldo: (d) => caldo(d),
  fritas,
  aneis: (d) => aneis(d),
  empanados,
  bebida,
  garrafa,
  milkshake: (d) => milkshake(d),
  'sobremesa-quente': sobremesaQuente,
  fatia: (d) => fatia(d),
};

/**
 * O que o gerador exporta e o seed consome, um arquivo por entrada.
 *
 * Quantas variantes de cada: proporcional a quantos itens daquele tipo um
 * cardápio costuma ter. Doze burgers pedem quatro pilhas diferentes; a fatia de
 * torta é uma só porque só há uma no cardápio.
 */
export const CATALOGO = [
  { nome: 'burger-1', receita: 'burger', variante: 0 },
  { nome: 'burger-2', receita: 'burger', variante: 1 },
  { nome: 'burger-3', receita: 'burger', variante: 2 },
  { nome: 'burger-4', receita: 'burger', variante: 3 },
  { nome: 'burger-bacon', receita: 'burger', variante: 4 },
  { nome: 'burger-cogumelo', receita: 'burger', variante: 5 },
  { nome: 'burger-trinca', receita: 'burger', variante: 6 },
  { nome: 'burger-kids', receita: 'burger', variante: 7 },
  { nome: 'pizza', receita: 'pizza', variante: 0 },
  { nome: 'caldo', receita: 'caldo', variante: 0 },
  { nome: 'fritas-1', receita: 'fritas', variante: 0 },
  { nome: 'fritas-2', receita: 'fritas', variante: 1 },
  { nome: 'aneis', receita: 'aneis', variante: 0 },
  { nome: 'empanados-1', receita: 'empanados', variante: 0 },
  { nome: 'empanados-2', receita: 'empanados', variante: 1 },
  { nome: 'empanados-3', receita: 'empanados', variante: 2 },
  { nome: 'bebida-1', receita: 'bebida', variante: 0 },
  { nome: 'bebida-2', receita: 'bebida', variante: 1 },
  { nome: 'bebida-3', receita: 'bebida', variante: 2 },
  { nome: 'bebida-4', receita: 'bebida', variante: 3 },
  { nome: 'garrafa-1', receita: 'garrafa', variante: 0 },
  { nome: 'garrafa-2', receita: 'garrafa', variante: 1 },
  { nome: 'milkshake', receita: 'milkshake', variante: 0 },
  { nome: 'sobremesa-1', receita: 'sobremesa-quente', variante: 0 },
  { nome: 'sobremesa-2', receita: 'sobremesa-quente', variante: 1 },
  { nome: 'fatia', receita: 'fatia', variante: 0 },
] as const;

export type NomeDeModelo = (typeof CATALOGO)[number]['nome'];

/** Monta um prato do catálogo. */
export function pratoDeTeste(nome: string, detalhe: Detalhe = 1): PratoDeTeste {
  const entrada = CATALOGO.find((c) => c.nome === nome) ?? CATALOGO[0];
  const receita = RECEITAS[entrada.receita];

  const grupo = new THREE.Group();
  grupo.add(receita(detalhe, entrada.variante));

  // Hambúrguer e pizza trazem a própria base; o resto já vem com prato ou copo.
  if (entrada.receita === 'burger') {
    grupo.add(pratoRaso(detalhe));
    grupo.children[0].position.y = 0.006;
  }

  let triangulos = 0;
  grupo.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const i = o.geometry.index;
      triangulos += i ? i.count / 3 : o.geometry.attributes.position.count / 3;
    }
  });

  return { objeto: grupo, triangulos: Math.round(triangulos) };
}
