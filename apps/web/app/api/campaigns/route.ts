import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';

/**
 * POST /api/campaigns — cria a campanha E popula a fila de leads.
 *
 * Corpo: { name, flow_id, quota_daily?, segment?: { status?, tag?, limit? } }
 *
 * Criar campanha vazia e preencher depois seria uma tela a mais para o
 * mesmo ato: quem cria uma campanha está escolhendo "este script para
 * estas pessoas". O segmento é resolvido aqui, no servidor, contra
 * `leads` — o browser nunca manda a lista de ids.
 *
 * A campanha nasce 'draft'. Começar a disparar é um segundo clique,
 * consciente, na tela de detalhe — e passa pelo motor, que é dono da
 * transição de estado.
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.flow_id) {
    return NextResponse.json({ error: 'name_and_flow_id_required' }, { status: 400 });
  }

  const quotaDaily =
    body.quota_daily === '' || body.quota_daily === null || body.quota_daily === undefined
      ? null
      : Number(body.quota_daily);
  if (quotaDaily !== null && (!Number.isFinite(quotaDaily) || quotaDaily < 0)) {
    return NextResponse.json({ error: 'invalid_quota_daily' }, { status: 400 });
  }

  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .insert({
      workspace_id: WORKSPACE_ID,
      name: String(body.name).slice(0, 200),
      flow_id: body.flow_id,
      quota_daily: quotaDaily,
      status: 'draft',
    })
    .select()
    .single();

  if (campErr) {
    // 23503 = foreign_key_violation → flow_id que não existe
    const badFlow = campErr.code === '23503';
    return NextResponse.json(
      { error: badFlow ? 'flow_not_found' : 'insert_failed', message: campErr.message },
      { status: badFlow ? 400 : 500 }
    );
  }

  const segment = body.segment || {};
  let query = supabase
    .from('leads')
    .select('id')
    .eq('workspace_id', WORKSPACE_ID)
    .order('created_at', { ascending: true });

  if (segment.status) query = query.eq('status', segment.status);
  // Tag mora em metadata (JSONB) porque a 001 não tem coluna `tags`.
  // `contains` vira @> no Postgres, que usa índice GIN se um dia houver.
  if (segment.tag) query = query.contains('metadata', { tags: [segment.tag] });

  const limit = Number(segment.limit);
  if (Number.isFinite(limit) && limit > 0) query = query.limit(limit);

  const { data: leads, error: leadsErr } = await query;
  if (leadsErr) {
    return NextResponse.json(
      { error: 'segment_query_failed', message: leadsErr.message, campaign_id: campaign.id },
      { status: 500 }
    );
  }

  const queue = (leads || []).map((l: { id: string }) => ({
    campaign_id: campaign.id,
    lead_id: l.id,
  }));

  if (queue.length) {
    const { error: queueErr } = await supabase
      .from('campaign_leads')
      // ignoreDuplicates: a UNIQUE (campaign_id, lead_id) já impede
      // repetido; sem isso um clique duplo voltaria 409 em vez de ser
      // idempotente.
      .upsert(queue, { onConflict: 'campaign_id,lead_id', ignoreDuplicates: true });
    if (queueErr) {
      return NextResponse.json(
        { error: 'queue_failed', message: queueErr.message, campaign_id: campaign.id },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, campaign, queued: queue.length });
}
