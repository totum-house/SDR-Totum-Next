import { PageHeader } from '@/components/PageHeader';

export default function ConsolePage() {
  return (
    <div>
      <PageHeader
        title="Console"
        subtitle="Conversas em tempo real com leads WhatsApp"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Conversas ativas</div>
          <div className="text-3xl font-semibold text-zinc-100">—</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Mensagens hoje</div>
          <div className="text-3xl font-semibold text-zinc-100">—</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Motor status</div>
          <div className="text-3xl font-semibold text-zinc-100">
            <span className="text-brand-400">●</span> <span className="text-lg">/health</span>
          </div>
        </div>
      </div>

      <div className="mt-6 card">
        <div className="text-sm text-zinc-400">
          Stub scaffold — próximas fases plugam SSE stream, message list, painel de lead ativo.
        </div>
      </div>
    </div>
  );
}
