/**
 * Selo da plataforma no rodapé do cardápio.
 *
 * White label: a marca que o cliente do restaurante enxerga é a DO
 * RESTAURANTE. A Markello assina embaixo, discreta — quem está com fome quer
 * ver comida, e cada pixel dessa tela deveria estar vendendo. Nossa marca
 * aparece para quem procura, não para quem passa.
 */
export function MarkelloBadge() {
  return (
    <footer className="px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-8 text-center">
      <p className="text-[11px] tracking-wide text-muted-foreground/60">
        feito com{' '}
        <span className="font-display tracking-normal text-muted-foreground/80">
          Markello
        </span>
      </p>
    </footer>
  );
}
