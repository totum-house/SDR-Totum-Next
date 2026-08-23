import { PageHeader } from '@/components/PageHeader';

export default function DatabaseSettingsPage() {
  return (
    <div>
      <PageHeader
        title="Database"
        subtitle="Supabase self-hosted · schema totum_sdr"
      />

      <div className="card">
        <div className="text-sm text-zinc-400">
          Stub — não implementado ainda. Próxima fase: status de conexão,
          migration atual aplicada, contagem de linhas por tabela.
        </div>
        <div className="mt-3 font-mono text-xs text-zinc-500">
          # spec: <span className="text-zinc-300">packages/db/migrations/001_bootstrap_totum_sdr.sql</span>
        </div>
      </div>
    </div>
  );
}
