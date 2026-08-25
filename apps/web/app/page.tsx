import Link from 'next/link';
import { Users, Megaphone, Gauge, Radio } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { NotConfigured } from '@/components/NotConfigured';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';
import { fetchMotorStatus } from '@/lib/motor';

// Dashboard de operação: nada aqui pode vir de cache. Um número de cota
// desatualizado é pior que nenhum número.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <div>
        <PageHeader title="Operação" subtitle="Visão do dia" />
        <NotConfigured />
      </div>
    );
  }

  // Em paralelo: nenhuma delas depende da outra, e o motor pode estar
  // lento/fora — não é motivo para segurar a contagem de leads.
  const [leadsCount, campaigns, motor] = await Promise.all([
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID),
    supabase
      .from('campaigns')
      .select('id, name, status, quota_daily')
      .eq('workspace_id', WORKSPACE_ID)
      .in('status', ['running', 'paused', 'draft'])
      .order('created_at', { ascending: false }),
    fetchMotorStatus(),
  ]);

  const totalLeads = leadsCount.count ?? 0;
  const ativas = (campaigns.data || []).filter((c) => c.status === 'running');
  const quota = motor.quota;
  const killed = motor.kill_switch === true;

  return (
    <div>
      <PageHeader
        title="Operação"
        subtitle="Visão do dia — leads, campanhas, cota e gateway"
        actions={
          <Link href="/campanhas/nova" className="btn-primary">
            Nova campanha
          </Link>
        }
      />

      {killed ? (
        <div className="card mb-6 border-brand-700/50 bg-brand-950/30">
          <div className="text-sm font-semibold text-brand-300">🛑 Kill switch ligado</div>
          <p className="mt-1 text-sm text-zinc-400">
            Nenhuma mensagem sai — nem campanha, nem resposta a quem escreveu. Desligar em{' '}
            <Link href="/config" className="text-brand-400 underline">
              /config
            </Link>
            .
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          label="Leads na base"
          value={totalLeads.toLocaleString('pt-BR')}
          icon={<Users className="h-4 w-4" />}
          hint={<Link href="/leads" className="hover:text-zinc-300">ver todos</Link>}
        />
        <StatCard
          label="Campanhas ativas"
          value={ativas.length}
          icon={<Megaphone className="h-4 w-4" />}
          hint={ativas[0]?.name ?? 'nenhuma rodando'}
          tone={ativas.length ? 'good' : 'neutral'}
        />
        <StatCard
          label="Cota usada hoje"
          value={quota ? `${quota.used}/${quota.limit}` : '—'}
          icon={<Gauge className="h-4 w-4" />}
          hint={quota ? `${quota.remaining} restantes` : 'motor offline'}
          tone={quota && quota.remaining === 0 ? 'warn' : 'neutral'}
        />
        <StatCard
          label="Gateway"
          value={motor.online ? (motor.mock_send ? 'mock' : 'online') : 'offline'}
          icon={<Radio className="h-4 w-4" />}
          hint={
            motor.online
              ? motor.window?.allowed
                ? 'dentro da janela'
                : `fora da janela (${motor.window?.reason ?? '—'})`
              : 'motor não respondeu em 127.0.0.1:3100'
          }
          tone={motor.online ? (motor.mock_send ? 'warn' : 'good') : 'bad'}
        />
      </div>

      <div className="mt-6 card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Campanhas</h2>
          <Link href="/campanhas" className="text-xs text-zinc-400 hover:text-zinc-200">
            ver todas →
          </Link>
        </div>
        {(campaigns.data || []).length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nenhuma campanha ainda.{' '}
            <Link href="/campanhas/nova" className="text-brand-400 underline">
              Criar a primeira
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {(campaigns.data || []).map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <Link href={`/campanhas/${c.id}`} className="text-sm text-zinc-200 hover:text-brand-400">
                  {c.name}
                </Link>
                <span className="text-xs uppercase tracking-wider text-zinc-500">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
