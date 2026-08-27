'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

/**
 * O carrossel de banners do topo (§12.10).
 *
 * `next/image` e não `<img>`: a CSP deste projeto é `img-src 'self' blob:
 * data:`, e o endereço do Storage não é 'self'. `<img>` cru seria bloqueado em
 * silêncio — `complete: true` com `naturalWidth: 0`, sem buraco na página. Já
 * aconteceu no preview do editor, e `pnpm check:imagens` existe por causa disso.
 *
 * TROCA SOZINHO, mas para quando alguém toca. Carrossel que continua girando
 * enquanto a pessoa tenta ler é a razão de banner ter má fama.
 */
export function BannerDoCardapio({
  imagens,
  intervaloMs = 5000,
}: {
  imagens: { url: string; alt?: string }[];
  intervaloMs?: number;
}) {
  const [atual, setAtual] = useState(0);
  const [parado, setParado] = useState(false);

  useEffect(() => {
    if (imagens.length < 2 || parado) return;

    // `prefers-reduced-motion` desliga a troca automática: quem marcou essa
    // preferência não quer coisa se mexendo sozinha na tela.
    const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduz) return;

    const t = setInterval(
      () => setAtual((i) => (i + 1) % imagens.length),
      Math.max(2000, intervaloMs),
    );
    return () => clearInterval(t);
  }, [imagens.length, intervaloMs, parado]);

  if (imagens.length === 0) return null;

  return (
    <div className="px-4">
      <div
        className="relative aspect-[2/1] w-full overflow-hidden rounded-xl bg-secondary"
        onPointerDown={() => setParado(true)}
      >
        {imagens.map((img, i) => (
          <Image
            key={img.url}
            src={img.url}
            alt={img.alt ?? ''}
            fill
            sizes="(max-width: 512px) 100vw, 512px"
            priority={i === 0}
            className={`object-cover transition-opacity duration-500 ${
              i === atual ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ))}
      </div>

      {imagens.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {imagens.map((img, i) => (
            <button
              key={img.url}
              type="button"
              aria-label={`Imagem ${i + 1} de ${imagens.length}`}
              aria-current={i === atual}
              onClick={() => { setAtual(i); setParado(true); }}
              className={`h-1.5 rounded-full transition-all ${
                i === atual ? 'w-5 bg-brand' : 'w-1.5 bg-muted-foreground/40'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
