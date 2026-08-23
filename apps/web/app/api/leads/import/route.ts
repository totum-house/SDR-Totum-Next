import { NextResponse } from 'next/server';

/**
 * POST /api/leads/import — importação de leads via CSV.
 *
 * Não implementado ainda (fase futura). Responde 501 em vez de 404
 * pra deixar explícito que a rota existe no design mas não está pronta.
 */
export async function POST() {
  return NextResponse.json({ error: 'not_implemented' }, { status: 501 });
}
