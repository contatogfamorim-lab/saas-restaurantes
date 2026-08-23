import type { NextConfig } from "next";

/**
 * Turbopack é o bundler padrão no Next 16 — não existe flag `--turbopack` nos
 * scripts, e configuração customizada de webpack quebra o build.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,

  experimental: {
    // Habilita forbidden() e unauthorized() de next/navigation, que renderizam
    // forbidden.tsx / unauthorized.tsx com o status HTTP correto.
    //
    // Sem a flag, chamar forbidden() lança um erro não tratado — a página
    // quebra em vez de dizer "sem permissão". Ainda é experimental, mas o que
    // depende dela é só a APRESENTAÇÃO da negativa: a decisão continua em
    // can(), nas policies de RLS e nas funções do banco.
    authInterrupts: true,
  },

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

    // O Next 16 recusa otimizar imagem cujo host resolve para IP privado —
    // é proteção contra SSRF, e em produção ela tem que continuar de pé: sem
    // ela, um `image_url` malicioso faria o servidor buscar endereços da rede
    // interna e devolver o conteúdo pelo /_next/image.
    //
    // Em desenvolvimento o Supabase local serve o Storage em 127.0.0.1, então
    // a proteção impediria qualquer foto de aparecer. Liberada SÓ aqui, e
    // amarrada ao NODE_ENV para não haver como vazar para produção por
    // esquecimento.
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",
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
