/**
 * Etiqueta não reconhecida.
 *
 * Deliberadamente vago: não diz se o código não existe, se a mesa foi
 * desativada ou se o restaurante está inativo. Distinguir esses casos
 * transformaria a tela num oráculo para quem estiver varrendo códigos
 * (spec §10.4).
 *
 * E não é um 404 técnico na cara de quem só queria jantar — é uma instrução
 * do que fazer agora.
 */
export default function TagNaoEncontrada() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-2xl leading-tight">Não achamos esta mesa</h1>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        A etiqueta pode ter sido trocada de lugar ou o cardápio pode estar fora
        do ar no momento.
      </p>

      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        Chame alguém da equipe — dá para fazer o pedido normalmente.
      </p>
    </main>
  );
}
