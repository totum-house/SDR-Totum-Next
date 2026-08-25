import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { NotConfigured } from '@/components/NotConfigured';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';
import { FlowCanvas, type FlowGraph } from './canvas';

export const dynamic = 'force-dynamic';

export default async function BuilderPage({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await params;
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <div>
        <PageHeader title="Builder" />
        <NotConfigured />
      </div>
    );
  }

  const { data: flow } = await supabase
    .from('flows')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('id', flowId)
    .maybeSingle();

  if (!flow) notFound();

  return (
    <div>
      <PageHeader
        title={flow.name}
        subtitle={
          <>
            v{flow.version} · {flow.is_active ? 'ativo' : 'inativo'} ·{' '}
            <Link href="/builder" className="text-zinc-400 hover:text-zinc-200">
              todos os flows
            </Link>
          </>
        }
      />
      <FlowCanvas
        flowId={flow.id}
        name={flow.name}
        isActive={flow.is_active}
        graph={(flow.graph || { nodes: [], edges: [] }) as FlowGraph}
      />
    </div>
  );
}
