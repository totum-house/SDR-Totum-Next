import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';

/**
 * GET /api/flows/:id  — carrega o flow inteiro (com graph)
 * PUT /api/flows/:id  — salva graph, nome e/ou is_active
 *
 * O builder manda o graph inteiro num PUT, não um diff. É o padrão de
 * acesso real de um editor visual (arrastou nó, mudou tudo de posição) e
 * é o que permite o graph continuar sendo um JSONB só, sem
 * flow_nodes/flow_edges.
 */

/** Tipos que o flow_runner sabe executar. Salvar um tipo que ele não
 *  conhece só descobriria o erro no primeiro disparo real — que, num
 *  número em warm-up, é caro. */
const NODE_TYPES = ['message', 'question', 'condition', 'improvise_with_goal', 'call_manus', 'end'];

type GraphNode = { id?: unknown; type?: unknown };

function validateGraph(graph: unknown): string | null {
  if (!graph || typeof graph !== 'object') return 'graph precisa ser objeto';
  const g = graph as { nodes?: unknown; edges?: unknown; entry_step_id?: unknown };
  if (!Array.isArray(g.nodes)) return 'graph.nodes precisa ser array';
  if (g.edges !== undefined && !Array.isArray(g.edges)) return 'graph.edges precisa ser array';
  if (g.nodes.length === 0) return 'graph precisa de pelo menos 1 nó';

  const ids = new Set<string>();
  for (const raw of g.nodes as GraphNode[]) {
    const node = raw || {};
    if (typeof node.id !== 'string' || !node.id) return 'todo nó precisa de id';
    if (ids.has(node.id)) return `id de nó duplicado: ${node.id}`;
    ids.add(node.id);
    if (typeof node.type !== 'string' || !NODE_TYPES.includes(node.type)) {
      return `tipo de nó desconhecido: ${String(node.type)} (aceitos: ${NODE_TYPES.join(', ')})`;
    }
  }

  // entry_step_id apontando para nó inexistente = flow que quebra no
  // primeiro step, com erro só em tempo de execução.
  if (g.entry_step_id !== undefined && g.entry_step_id !== null) {
    if (typeof g.entry_step_id !== 'string' || !ids.has(g.entry_step_id)) {
      return `entry_step_id "${String(g.entry_step_id)}" não existe entre os nós`;
    }
  }

  for (const edge of (g.edges || []) as { source?: unknown; target?: unknown }[]) {
    if (typeof edge?.source !== 'string' || !ids.has(edge.source)) {
      return `edge com source inválido: ${String(edge?.source)}`;
    }
    if (typeof edge?.target !== 'string' || !ids.has(edge.target)) {
      return `edge com target inválido: ${String(edge?.target)}`;
    }
  }

  return null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const { data, error } = await supabase
    .from('flows')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'flow_not_found' }, { status: 404 });
  return NextResponse.json({ flow: data });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const patch: Record<string, unknown> = {};

  if (body.graph !== undefined) {
    const problem = validateGraph(body.graph);
    if (problem) return NextResponse.json({ error: 'invalid_graph', message: problem }, { status: 422 });
    patch.graph = body.graph;
  }
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 200);
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('flows')
    .update(patch)
    .eq('workspace_id', WORKSPACE_ID)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'flow_not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, flow: data });
}
