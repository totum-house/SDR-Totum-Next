import { PageHeader } from '@/components/PageHeader';

export default function LeadsPage() {
  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Base de leads recebida via OpenWA + enriquecimento Manus"
      />

      <div className="card">
        <div className="text-sm text-zinc-400">
          Tabela de leads (stub). Colunas planejadas: phone, name, status, last_message_at,
          conversation_id, source, enriched_by_manus.
        </div>
      </div>
    </div>
  );
}
