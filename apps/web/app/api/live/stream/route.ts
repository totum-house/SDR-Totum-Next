import { NextResponse } from 'next/server';
import { motorUrl, motorAuthHeader } from '@/lib/motor';

/**
 * GET /api/live/stream — repassa o SSE do motor para o browser.
 *
 * Por que proxy e não o browser falando direto com o motor: o motor
 * escuta em 127.0.0.1:3100 (D-017) e o token de acesso dele é um segredo
 * de servidor. Entregar esse token para o browser seria entregar controle
 * do motor para qualquer aba aberta.
 *
 * O corpo é repassado como stream, sem bufferizar: `res.body` vai direto
 * para a resposta. Ler tudo antes de responder transformaria um stream
 * infinito em uma requisição que nunca termina.
 */

// SSE não pode ser pré-renderado nem cacheado — precisa de runtime Node
// e resposta dinâmica.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  let upstream: Response;
  try {
    upstream = await fetch(motorUrl('/sse/live'), {
      headers: { Accept: 'text/event-stream', ...motorAuthHeader() },
      cache: 'no-store',
      // Fechou a aba → aborta a conexão com o motor. Sem isso cada
      // refresh do painel deixaria um listener pendurado no motor.
      signal: req.signal,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'motor_unreachable', message: (err as Error).message },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: 'motor_stream_failed', status: upstream.status },
      { status: 502 }
    );
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Desliga o buffer do nginx/proxy: sem isso o "tempo real" chega
      // em blocos quando o buffer enche.
      'X-Accel-Buffering': 'no',
    },
  });
}
