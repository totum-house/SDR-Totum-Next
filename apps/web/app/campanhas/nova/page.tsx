import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { NotConfigured } from '@/components/NotConfigured';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';
import { NovaCampanhaForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NovaCampanhaPage() {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <div>
        <PageHeader title="Nova campanha" />
        <NotConfigured />
      </div>
    );
  }

  // Contagem por status alimenta o seletor de segmento: escolher
  // "somente novos" sabendo que são 87 é decisão; escolher no escuro é
  // aposta.
  const [{ data: flows }, { data: leads }] = await Promise.all([
    supabase
      .from('flows')
      .select('id, name, is_active, updated_at')
      .eq('workspace_id', WORKSPACE_ID)
      .order('updated_at', { ascending: false }),
    supabase.from('leads').select('status, metadata').eq('workspace_id', WORKSPACE_ID),
  ]);

  const porStatus: Record<string, number> = {};
  const tags = new Set<string>();
  for (const lead of leads || []) {
    porStatus[lead.status] = (porStatus[lead.status] || 0) + 1;
    for (const t of ((lead.metadata as { tags?: string[] })?.tags || [])) tags.add(t);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Nova campanha"
        subtitle="Um flow + um segmento de leads"
        actions={
          <Link href="/campanhas" className="btn-ghost border border-zinc-700">
            voltar
          </Link>
        }
      />
      <NovaCampanhaForm
        flows={flows || []}
        totalLeads={(leads || []).length}
        porStatus={porStatus}
        tags={Array.from(tags).sort()}
      />
    </div>
  );
}
