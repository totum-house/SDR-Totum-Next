import { PageHeader } from '@/components/PageHeader';

export default function WhatsappSettingsPage() {
  return (
    <div>
      <PageHeader
        title="WhatsApp / OpenWA"
        subtitle="Sessão, QR e webhook do gateway WhatsApp"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <div className="text-sm font-medium text-zinc-100 mb-2">Status da sessão</div>
          <div className="text-xs text-zinc-500 mb-3">
            Bind: <span className="font-mono text-zinc-300">127.0.0.1:3000</span>
          </div>
          <div className="text-sm text-zinc-400">
            Estado da conexão OpenWA (stub — próxima fase plugar /health e state).
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-medium text-zinc-100 mb-2">QR Scan</div>
          <div className="text-xs text-zinc-500 mb-3">
            Escanear apenas em ambiente autorizado (🔴 red — pede aprovação explícita).
          </div>
          <button disabled className="btn-primary opacity-40 cursor-not-allowed">
            Solicitar QR
          </button>
        </div>
      </div>

      <div className="mt-4 card border-brand-800/50 bg-brand-900/10">
        <div className="text-xs text-brand-300 uppercase tracking-wider mb-1">Aviso</div>
        <div className="text-sm text-zinc-300">
          VoIP DID <span className="font-mono">3131577292</span> requer warm-up ultra-conservador
          (dia 1-7: 1-2 msgs/dia; escala até 100/dia em D+90). Kill switch obrigatório.
        </div>
      </div>
    </div>
  );
}
