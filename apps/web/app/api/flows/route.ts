import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';

/**
 * GET  /api/flows — lista os flows do workspace
 * POST /api/flows — cria um flow novo com graph mínimo executável
 *
 * O graph inicial não é `{nodes: [], edges: []}`: um flow vazio salvo por
 * engano numa campanha faria o flow_runner lançar "node não encontrado"
 * no primeiro disparo. Nascer com um nó de mensagem torna qualquer flow
 * recém-criado executável desde o primeiro segundo.
 */

const GRAPH_INICIAL = {
  entry_step_id: 'msg_1',
  nodes: [
    {
      id: 'msg_1',
      type: 'message',
      text: 'Oi! Aqui é o assistente da Totum 👋',
      position: { x: 80, y: 80 },
    },
  ],
  edges: [],
};

export async function GET() {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const { data, error } = await supabase
    .from('flows')
    .select('id, name, version, is_active, created_at, updated_at')
    .eq('workspace_id', WORKSPACE_ID)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flows: data || [] });
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || '').trim() || 'Novo flow';

  const { data, error } = await supabase
    .from('flows')
    .insert({
      workspace_id: WORKSPACE_ID,
      name: name.slice(0, 200),
      version: 1,
      // Nasce inativo: `is_active` é o que o webhook usa para escolher o
      // flow de quem escreve do nada. Um flow em rascunho não deveria
      // virar o atendimento padrão só por ter sido criado.
      is_active: false,
      graph: GRAPH_INICIAL,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, flow: data });
}
