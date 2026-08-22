import { NextRequest, NextResponse } from 'next/server';
import { motorFetch } from '@/lib/motor';

/**
 * POST /api/webhook/openwa
 *
 * Proxy do webhook do OpenWA para o Motor SDR.
 * OpenWA prefere apontar direto para 127.0.0.1:3100 (menos hops),
 * mas esta rota existe para casos onde precisa passar por Vercel/frontend
 * (ex: ambiente cloud onde motor está em LAN privada via túnel).
 *
 * Segurança: revalida Bearer OPENWA_WEBHOOK_TOKEN antes de repassar.
 */
export async function POST(req: NextRequest) {
  const token = process.env.OPENWA_WEBHOOK_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'webhook_token_not_configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const res = await motorFetch('/api/webhook/openwa', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
