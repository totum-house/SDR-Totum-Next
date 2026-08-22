import { NextResponse } from 'next/server';
import { motorFetch } from '@/lib/motor';

/**
 * GET /api/health — proxy para motor 127.0.0.1:3100/health.
 * Retorna {web, motor} para dashboard.
 */
export async function GET() {
  let motor: unknown = { status: 'unreachable' };
  try {
    const res = await motorFetch('/health');
    if (res.ok) motor = await res.json();
    else motor = { status: 'error', code: res.status };
  } catch (err) {
    motor = { status: 'unreachable', error: (err as Error).message };
  }
  return NextResponse.json({
    web: { status: 'ok', uptime_s: Math.round(process.uptime()) },
    motor,
  });
}
