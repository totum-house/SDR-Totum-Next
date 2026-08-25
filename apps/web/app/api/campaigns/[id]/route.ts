import { NextRequest, NextResponse } from 'next/server';
import { motorFetch } from '@/lib/motor';

/**
 * PATCH /api/campaigns/:id — { action: 'start' | 'pause' }
 *
 * Proxy para o motor, não UPDATE direto no banco. A transição de estado
 * é do motor de propósito: é ele que precisa saber que passou a existir
 * campanha rodando, que publica o evento no /live, e que recebe do banco
 * o 409 do índice uq_campaigns_one_running quando já há outra rodando.
 * Um UPDATE daqui daria o mesmo resultado no banco e nenhum dos três
 * efeitos.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action !== 'start' && action !== 'pause') {
    return NextResponse.json({ error: 'action_must_be_start_or_pause' }, { status: 400 });
  }

  try {
    const res = await motorFetch(`/api/campaigns/${id}/${action}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    // Motor fora do ar é o caso comum aqui (PM2 caiu, túnel fechou), e a
    // tela precisa dizer isso em vez de "erro interno".
    return NextResponse.json(
      { error: 'motor_unreachable', message: (err as Error).message },
      { status: 502 }
    );
  }
}
