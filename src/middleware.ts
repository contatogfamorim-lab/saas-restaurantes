import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /**
     * Roda em tudo, MENOS estáticos, imagens e o cardápio do cliente.
     *
     * `/m/*` fica de fora de propósito: é a rota pública que precisa abrir sem
     * login e o mais rápido possível (2s no 4G, spec §16). Passar por
     * `auth.getUser()` a cada abertura de cardápio adicionaria uma ida ao
     * servidor de auth para nada — não existe usuário logado ali, e a sessão de
     * mesa tem cookie próprio.
     */
    '/((?!_next/static|_next/image|favicon.ico|m/|api/mesa|api/pedidos|privacidade|.*\\.(?:svg|png|jpg|jpeg|webp|avif|gif|woff2)$).*)',
  ],
};
