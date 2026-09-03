import type { NextConfig } from "next";

/**
 * Turbopack é o bundler padrão no Next 16 — não existe flag `--turbopack` nos
 * scripts, e configuração customizada de webpack quebra o build.
 */
/**
 * O host do Supabase deste ambiente, para o `next/image` aceitar as fotos.
 *
 * Em desenvolvimento ele nem sempre é `127.0.0.1`: para abrir o cardápio NO
 * CELULAR — única forma de testar o AR e o 3D rolando de verdade — a variável
 * vira o IP da máquina na rede local, porque `127.0.0.1` do outro lado do wi-fi
 * é o próprio telefone. Sem esta entrada as fotos param de carregar com
 * "hostname is not configured", enquanto os modelos 3D continuam aparecendo —
 * e o cardápio fica meio quebrado de um jeito que confunde.
 */
function hostDoSupabase(): { protocol: "http" | "https"; hostname: string; port: string } | null {
  const bruto = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!bruto) return null;

  try {
    const url = new URL(bruto);
    return {
      protocol: url.protocol === "https:" ? "https" : "http",
      hostname: url.hostname,
      port: url.port,
    };
  } catch {
    return null;
  }
}

const supabase = hostDoSupabase();

const nextConfig: NextConfig = {
  reactCompiler: true,

  /**
   * Empacota o servidor com SÓ o que ele usa — mas NÃO na Vercel.
   *
   * Em container ou VM, standalone é a diferença entre 48 MB e 2,4 GB: sem ele
   * o deploy carrega `node_modules` inteiro, quase 1 GB de ferramenta de build
   * que nunca roda em produção.
   *
   * Na Vercel ele QUEBRA o build. Eu tinha escrito o contrário na
   * documentação, sem testar, e o deploy falhou assim:
   *
   *     Error: ENOENT: no such file or directory,
   *       open '/vercel/path0/.next/next-server.js.nft.json'
   *
   * O motivo: com standalone o Next grava os arquivos de rastreamento dentro
   * de `.next/standalone/`, e o `onBuildComplete` da Vercel os procura na raiz
   * do `.next`. O build compila inteiro, passa no TypeScript, gera as páginas —
   * e morre no último passo, que é o pior lugar para descobrir.
   *
   * `VERCEL` é definida pela própria Vercel durante o build. Fora dela, o
   * standalone continua valendo.
   */
  output: process.env.VERCEL ? undefined : "standalone",

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
      // O host deste ambiente, quando não for um dos dois acima — o caso de
      // desenvolvimento apontando para o IP da rede local, para testar no
      // celular.
      ...(supabase
        ? [{ ...supabase, pathname: "/storage/v1/object/public/**" as const }]
        : []),
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
          // Permissions-Policy NÃO fica aqui: ela depende da rota desde que o
          // cardápio ganhou AR, e este arquivo não sabe qual rota está sendo
          // servida. Passou para `src/proxy.ts`, ao lado da CSP, que já decide
          // por caminho. Duas regras em `headers()` — uma genérica e uma para
          // `/m/` — mandariam DOIS cabeçalhos na mesma resposta, e o navegador
          // não promete qual deles vale.
        ],
      },
    ];
    // PENDENTE (Etapa 12): CSP com nonce. Fica fora agora de propósito —
    // uma CSP mal calibrada quebra o dev server e some com a tela da cozinha
    // no meio do serviço. Precisa ser montada junto com o middleware.
  },
};

export default nextConfig;
