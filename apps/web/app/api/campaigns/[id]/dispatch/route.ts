import { NextResponse } from 'next/server';

/**
 * POST /api/campaigns/:id/dispatch — dispara warm-up de uma campanha.
 *
 * Não implementado ainda: schema de campaigns/warmup_state não existe
 * (ver docs/ARCHITECTURE.md) e warm-up de WhatsApp é camada L11 no
 * protocolo de camadas — 🔴 vermelho, decisão do Rael
 * (docs/PROTOCOL_CAMADAS.md). Responde 501 em vez de 404 pra deixar
 * explícito que a rota existe no design mas não está pronta.
 */
export async function POST() {
  return NextResponse.json({ error: 'not_implemented' }, { status: 501 });
}
