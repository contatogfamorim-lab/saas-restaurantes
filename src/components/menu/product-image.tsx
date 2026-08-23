import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * Foto do produto, com placeholder para quando ela não existe.
 *
 * A spec §4 é explícita: "placeholder elegante quando faltar, nunca ícone
 * genérico quebrado". Um cardápio meio preenchido acontece de verdade — no dia
 * da implantação o dono ainda não fotografou tudo — e o item sem foto não pode
 * parecer defeito.
 *
 * O placeholder deriva do NOME: mesma comida, mesma cor, sempre. Duas fatias de
 * gradiente na faixa quente da paleta, mais a inicial em tipografia condensada.
 * Parece decisão de design, não ausência.
 */

/** djb2 — determinístico e estável entre servidor e cliente (nada de Math.random). */
function hashName(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface Props {
  name: string;
  url: string | null;
  /** `true` só para as fotos acima da dobra — o resto carrega preguiçoso (§13.2). */
  priority?: boolean;
  className?: string;
  sizes?: string;
}

export function ProductImage({ name, url, priority = false, className, sizes }: Props) {
  if (url) {
    return (
      <Image
        src={url}
        alt={name}
        fill
        sizes={sizes ?? '(max-width: 768px) 40vw, 240px'}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        className={cn('object-cover', className)}
      />
    );
  }

  // 20°–70° em OKLCH: da brasa ao mel, sempre dentro da paleta da casa.
  // Só a MATIZ vem daqui; a luminosidade fica no CSS, que sabe o tema atual.
  const hue = 20 + (hashName(name) % 50);

  return (
    <div
      aria-hidden
      className={cn(
        'product-placeholder absolute inset-0 flex items-center justify-center overflow-hidden',
        className,
      )}
      style={{ '--ph-hue': hue } as React.CSSProperties}
    >
      <span className="font-display select-none text-4xl tracking-tight">
        {initials(name)}
      </span>
    </div>
  );
}
