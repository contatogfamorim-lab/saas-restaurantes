/**
 * Cor de marca do restaurante (white label).
 *
 * O dono escolhe `brand_color` e ela vira o acento do cardápio. O problema é
 * que ele vai escolher amarelo-limão, e texto branco sobre amarelo-limão não
 * se lê. Como a cor é dado de tenant e não decisão nossa, o contraste tem que
 * ser CALCULADO, não confiado ao bom senso de quem preencheu o campo.
 *
 * `color-contrast()` do CSS resolveria isso nativamente, mas ainda não tem
 * suporte confiável — então a conta acontece no servidor, uma vez por página.
 */

const FALLBACK = '#D97A28';

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** Luminância relativa segundo a WCAG 2.1. */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Texto legível sobre a cor de marca.
 *
 * Testa branco e um quase-preto quente (que combina com a paleta) e devolve o
 * de maior contraste. Nunca devolve o que "fica mais bonito" — devolve o que
 * se lê num celular, num restaurante escuro, por alguém com a visão cansada.
 */
export function readableOn(brandColor: string): string {
  const rgb = parseHex(brandColor) ?? parseHex(FALLBACK)!;
  const bg = relativeLuminance(rgb);

  const white = contrastRatio(bg, 1);
  const ink = contrastRatio(bg, relativeLuminance({ r: 26, g: 21, b: 18 }));

  return white >= ink ? '#ffffff' : '#1a1512';
}

/** Normaliza para `#rrggbb`, caindo no âmbar da plataforma se vier lixo. */
export function safeBrandColor(brandColor: string | null | undefined): string {
  if (!brandColor) return FALLBACK;
  return parseHex(brandColor) ? brandColor : FALLBACK;
}

/**
 * Variáveis CSS a injetar na raiz do cardápio.
 * Sobrescrevem o âmbar da plataforma pela marca do restaurante.
 */
export function brandStyle(brandColor: string | null | undefined): React.CSSProperties {
  const color = safeBrandColor(brandColor);
  return {
    '--primary': color,
    '--primary-foreground': readableOn(color),
    '--ring': color,
    '--brand': color,
  } as React.CSSProperties;
}
