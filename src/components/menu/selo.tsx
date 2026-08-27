import type { SeloDoCardapio } from '@/lib/menu/types';

/**
 * O selo no card do prato.
 *
 * Antes eram quatro pílulas cinzas idênticas, com o rótulo vindo de um mapa
 * fixo no código. Cinza igual para tudo não destaca nada: se "PICANTE" e "MAIS
 * PEDIDO" têm o mesmo peso visual, nenhum dos dois está avisando coisa alguma.
 *
 * Agora cor e animação vêm do cadastro da casa. A cor entra por `style` porque
 * é dado, não classe — Tailwind não gera classe para hexadecimal que só existe
 * em tempo de execução.
 *
 * ANIMAÇÃO COM PARCIMÔNIA, e a tela do editor diz isso: `none` é o padrão, e
 * uma casa que puser brilho em todos os selos volta ao problema de origem.
 */
export function Selo({ selo }: { selo: SeloDoCardapio }) {
  return (
    <span
      className={`selo selo--${selo.animation}`}
      style={{ '--selo': selo.color } as React.CSSProperties}
    >
      {selo.label}
    </span>
  );
}
