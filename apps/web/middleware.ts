import { NextRequest, NextResponse } from 'next/server';

/**
 * middleware.ts — gate mínimo de autenticação nas API Routes.
 *
 * Valida a PRESENÇA do cookie de sessão SSO `.grupototum.com` antes de
 * qualquer rota /api/*, com duas exceções:
 *   - /api/health         healthcheck público (usado por monitoramento)
 *   - /api/webhook/*      chamado server-to-server pelo OpenWA, que já
 *                         valida seu próprio Bearer OPENWA_WEBHOOK_TOKEN
 *                         (ver apps/web/app/api/webhook/openwa/route.ts);
 *                         o browser do usuário nunca chama essa rota, então
 *                         exigir cookie SSO aqui quebraria a integração.
 *
 * Isto NÃO é verificação criptográfica do JWT — Supabase Auth ainda não
 * está conectado neste app (ver docs/PROTOCOL_CAMADAS.md, L8 é
 * 🔴 vermelho — nunca sozinho). Assim que Auth estiver conectado, trocar
 * por validação real de assinatura (ex: supabase.auth.getUser()).
 */

const SSO_COOKIE_NAME = process.env.SSO_COOKIE_NAME || 'sb-access-token';

const PUBLIC_API_PREFIXES = ['/api/health', '/api/webhook'];

function isPublicApiPath(pathname: string) {
  return PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SSO_COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
