import { PageHeader } from '@/components/PageHeader';

const PROVIDERS = [
  { name: 'Gemini',   model: 'gemini-2.0-flash-exp',      env: 'GEMINI_API_KEY', order: 1 },
  { name: 'Groq',     model: 'llama-3.3-70b-versatile',    env: 'GROQ_API_KEY',   order: 2 },
  { name: 'NVIDIA',   model: 'meta/llama-3.3-70b-instruct', env: 'NVIDIA_API_KEY', order: 3 },
];

export default function ProvidersSettingsPage() {
  return (
    <div>
      <PageHeader
        title="LLM Providers"
        subtitle="Chain de fallback: gemini → groq → nvidia"
      />

      <div className="card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-700">
              <th className="py-2 pr-4">#</th>
              <th className="py-2 pr-4">Provider</th>
              <th className="py-2 pr-4">Modelo padrão</th>
              <th className="py-2 pr-4">Env var</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {PROVIDERS.map((p) => (
              <tr key={p.name} className="border-b border-zinc-800 last:border-0">
                <td className="py-3 pr-4 text-zinc-400">{p.order}</td>
                <td className="py-3 pr-4 font-medium text-zinc-100">{p.name}</td>
                <td className="py-3 pr-4 font-mono text-xs text-zinc-400">{p.model}</td>
                <td className="py-3 pr-4 font-mono text-xs text-zinc-400">{p.env}</td>
                <td className="py-3 text-zinc-500">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-zinc-500">
        Spec: <span className="font-mono text-zinc-400">apps/motor/src/llm_provider.js</span>
      </div>
    </div>
  );
}
