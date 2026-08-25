import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { NotConfigured } from '@/components/NotConfigured';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  running: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60',
  paused: 'bg-amber-950/60 text-amber-400 border-amber-800/60',
  draft: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  done: 'bg-zinc-900 text-zinc-500 border-zinc-800',
};

export default async function CampanhasPage() {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <div>
        <PageHeader title="Campanhas" subtitle="Disparos em lote por flow" />
        <NotConfigured />
      </div>
    );
  }

  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, name, status, quota_daily, started_at, created_at, flow_id')
    .eq('workspace_id', WORKSPACE_ID)
    .order('created_at', { ascending: false });

  // Progresso da fila numa query só, em vez de N+1: traz os
  // campaign_leads das campanhas listadas e conta em memória. Com dezenas
  // de campanhas e milhares de leads isso vira uma view; hoje não é.
  const ids = (campaigns || []).map((c) => c.id);
  const { data: queue } = ids.length
    ? await supabase.from('campaign_leads').select('campaign_id, status').in('campaign_id', ids)
    : { data: [] as { campaign_id: string; status: string }[] };

  const progress = new Map<string, { total: number; queued: number }>();
  for (const row of queue || []) {
    const cur = progress.get(row.campaign_id) || { total: 0, queued: 0 };
    cur.total += 1;
    if (row.status === 'queued') cur.queued += 1;
    progress.set(row.campaign_id, cur);
  }

  return (
    <div>
      <PageHeader
        title="Campanhas"
        subtitle="Disparos em lote por flow, respeitando cota e janela"
        actions={
          <Link href="/campanhas/nova" className="btn-primary">
            <Plus className="h-4 w-4" />
            Nova campanha
          </Link>
        }
      />

      {error ? (
        <div className="card border-brand-700/50 text-sm text-brand-300">{error.message}</div>
      ) : (campaigns || []).length === 0 ? (
        <div className="card text-sm text-zinc-500">
          Nenhuma campanha ainda.{' '}
          <Link href="/campanhas/nova" className="text-brand-400 underline">
            Criar a primeira
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-2">
          {(campaigns || []).map((c) => {
            const p = progress.get(c.id) || { total: 0, queued: 0 };
            const enviados = p.total - p.queued;
            const pct = p.total ? Math.round((enviados / p.total) * 100) : 0;
            return (
              <Link
                key={c.id}
                href={`/campanhas/${c.id}`}
                className="card block transition-colors hover:border-zinc-600"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-100">{c.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {enviados}/{p.total} lead(s) processado(s)
                      {c.quota_daily != null ? ` · cota própria ${c.quota_daily}/dia` : ''}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      STATUS_TONE[c.status] || STATUS_TONE.draft
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded bg-zinc-800">
                  <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
