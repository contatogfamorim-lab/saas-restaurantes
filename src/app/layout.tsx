import type { Metadata, Viewport } from "next";
import { Geist, Oswald } from "next/font/google";

import { cn } from "@/lib/utils";
import "./globals.css";

/**
 * Duas famílias, com trabalhos distintos (spec §11):
 *  - Oswald, condensada, para NOME DE PRATO. É de onde vem a personalidade.
 *  - Geist, neutra, para descrição e preço. É onde a legibilidade importa.
 *
 * `display: swap` nas duas: em 4G, texto invisível esperando fonte é pior que
 * texto trocando de forma — e o cardápio tem 2s para abrir (spec §16).
 */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-oswald",
  display: "swap",
});

export const metadata: Metadata = {
  // White label: o título real de cada cardápio vem do restaurante, definido
  // em generateMetadata de /m/[short_code]. Isto é só o fallback da plataforma.
  title: "Pedidos.IA",
  description: "Cardápio digital por mesa",
};

export const viewport: Viewport = {
  // Sem maximumScale nem userScalable: travar zoom quebra a acessibilidade de
  // quem precisa aumentar o texto, e o cardápio é lido por todo mundo.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a1512" },
    { media: "(prefers-color-scheme: light)", color: "#faf8f5" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={cn(geist.variable, oswald.variable)}>
      <body>{children}</body>
    </html>
  );
}
