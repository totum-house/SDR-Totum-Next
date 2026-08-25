import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { NotConfigured } from '@/components/NotConfigured';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';
import { NovoFlowButton } from './novo';

export const dynamic = 'force-dynamic';

export default async function BuilderIndexPage() {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <div>
        <PageHeader title="Builder" subtitle="Scripts de conversação" />
        <NotConfigured />
      </div>
    );
  }

  const { data: flows } = await supabase
    .from('flows')
    .select('id, name, version, is_active, graph, updated_at')
    .eq('workspace_id', WORKSPACE_ID)
    .order('updated_at', { ascending: false });

  return (
    <div>
      <PageHeader
        title="Builder"
        subtitle="Scripts de conversação — o que o SDR fala, e em que ordem"
        actions={<NovoFlowButton />}
      />

      {(flows || []).length === 0 ? (
        <div className="card text-sm text-zinc-500">
          Nenhum flow ainda. Crie o primeiro — ele já nasce com um nó de mensagem executável.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(flows || []).map((f) => {
            const nos = ((f.graph as { nodes?: unknown[] })?.nodes || []).length;
            return (
              <Link
                key={f.id}
                href={`/builder/${f.id}`}
                className="card block transition-colors hover:border-zinc-600"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-100">{f.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      v{f.version} · {nos} nó(s)
                    </div>
                  </div>
                  {f.is_active ? (
                    <span className="shrink-0 rounded border border-emerald-800/60 bg-emerald-950/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-400">
                      ativo
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="card mt-6 text-xs text-zinc-500">
        <strong className="text-zinc-400">Flow &ldquo;ativo&rdquo;</strong> é o que o motor usa
        quando alguém escreve do nada, sem campanha. Campanha sempre usa o flow escolhido nela,
        ativo ou não.
      </div>
    </div>
  );
}
