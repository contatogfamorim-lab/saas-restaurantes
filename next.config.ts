import type { NextConfig } from "next";

/**
 * Turbopack é o bundler padrão no Next 16 — não existe flag `--turbopack` nos
 * scripts, e configuração customizada de webpack quebra o build.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,

  images: {
    // Spec §13.2: egress é o segundo teto do plano Pro. Servir o JPEG original
    // do upload derruba a capacidade de ~200 mil para ~40 mil aberturas/mês.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Storage do Supabase (fotos de produto). Só o host do projeto.
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "54321", pathname: "/storage/v1/object/public/**" },
    ],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
    // PENDENTE (Etapa 12): CSP com nonce. Fica fora agora de propósito —
    // uma CSP mal calibrada quebra o dev server e some com a tela da cozinha
    // no meio do serviço. Precisa ser montada junto com o middleware.
  },
};

export default nextConfig;
