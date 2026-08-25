import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { NotConfigured } from '@/components/NotConfigured';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';
import { fetchMotorStatus } from '@/lib/motor';
import { CampanhaControls } from './controls';

export const dynamic = 'force-dynamic';

export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <div>
        <PageHeader title="Campanha" />
        <NotConfigured />
      </div>
    );
  }

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('id', id)
    .maybeSingle();

  if (!campaign) notFound();

  const [{ data: flow }, { data: queue }, motor] = await Promise.all([
    supabase.from('flows').select('id, name, is_active').eq('id', campaign.flow_id).maybeSingle(),
    supabase.from('campaign_leads').select('status, last_error').eq('campaign_id', id),
    fetchMotorStatus(),
  ]);

  const counts = { queued: 0, dispatched: 0, failed: 0, skipped: 0 };
  const erros: string[] = [];
  for (const row of queue || []) {
    counts[row.status as keyof typeof counts] = (counts[row.status as keyof typeof counts] || 0) + 1;
    if (row.status === 'failed' && row.last_error && erros.length < 5) erros.push(row.last_error);
  }
  const total = (queue || []).length;

  // Por que a campanha pode não estar disparando agora — a pergunta que o
  // operador faz olhando para "running" e nada acontecendo.
  const impedimentos: string[] = [];
  if (!motor.online) impedimentos.push('motor não respondeu em 127.0.0.1:3100');
  if (motor.kill_switch) impedimentos.push('kill switch ligado em /config');
  if (motor.window && !motor.window.allowed) {
    impedimentos.push(
      motor.window.reason === 'weekday'
        ? 'hoje não é dia permitido na janela'
        : 'fora do horário da janela'
    );
  }
  if (motor.quota && motor.quota.remaining === 0) impedimentos.push('cota do dia esgotada');
  if (counts.queued === 0 && campaign.status === 'running') impedimentos.push('fila vazia');

  return (
    <div>
      <PageHeader
        title={campaign.name}
        subtitle={
          <>
            flow{' '}
            {flow ? (
              <Link href={`/builder/${flow.id}`} className="text-brand-400 hover:underline">
                {flow.name}
              </Link>
            ) : (
              <span className="text-brand-400">(flow não encontrado)</span>
            )}{' '}
            · status <strong className="uppercase">{campaign.status}</strong>
          </>
        }
        actions={<CampanhaControls id={campaign.id} status={campaign.status} />}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Na fila" value={counts.queued} hint={`de ${total} lead(s)`} />
        <StatCard label="Disparados" value={counts.dispatched} tone="good" />
        <StatCard label="Falharam" value={counts.failed} tone={counts.failed ? 'bad' : 'neutral'} />
        <StatCard
          label="Cota hoje"
          value={motor.quota ? `${motor.quota.used}/${motor.quota.limit}` : '—'}
          hint={campaign.quota_daily != null ? `cota própria: ${campaign.quota_daily}` : 'cota global'}
        />
      </div>

      {campaign.status === 'running' && impedimentos.length ? (
        <div className="card mt-6 border-amber-700/40 bg-amber-950/20">
          <div className="text-sm font-medium text-amber-300">
            Campanha em execução, mas parada agora
          </div>
          <ul className="mt-2 space-y-1 text-sm text-zinc-400">
            {impedimentos.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">
            Nada disso é erro — é o motor respeitando as travas. Ele volta sozinho quando a
            condição mudar.
          </p>
        </div>
      ) : null}

      {erros.length ? (
        <div className="card mt-6">
          <div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
            Últimos erros da fila
          </div>
          <ul className="space-y-1 font-mono text-xs text-zinc-400">
            {erros.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card mt-6 text-sm text-zinc-400">
        Acompanhe o disparo ao vivo em{' '}
        <Link href="/live" className="text-brand-400 underline">
          /live
        </Link>
        .
      </div>
    </div>
  );
}
