import { PageHeader } from '@/components/PageHeader';

export default function SecretsSettingsPage() {
  return (
    <div>
      <PageHeader
        title="Secrets"
        subtitle="Tokens webhook, Manus, service_role"
      />

      <div className="card border-brand-800/50 bg-brand-900/10">
        <div className="text-xs text-brand-300 uppercase tracking-wider mb-1">Aviso</div>
        <div className="text-sm text-zinc-300">
          Stub — não implementado ainda. Secrets nunca serão exibidos em texto
          claro nesta tela; próxima fase mostra apenas metadados (nome,
          última rotação, status configurado/ausente).
        </div>
      </div>
    </div>
  );
}
