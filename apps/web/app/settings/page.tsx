import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { MessageSquare, KeyRound, Database, Bot } from 'lucide-react';

const SECTIONS = [
  { href: '/settings/whatsapp',  label: 'WhatsApp / OpenWA', desc: 'QR, sessão, webhook token', icon: MessageSquare },
  { href: '/settings/providers', label: 'LLM Providers',      desc: 'Gemini, Groq, NVIDIA chain', icon: Bot },
  { href: '/settings/database',  label: 'Database',           desc: 'Supabase supa.grupototum.com · totum_sdr', icon: Database },
  { href: '/settings/secrets',   label: 'Secrets',            desc: 'Tokens webhook, Manus, service_role', icon: KeyRound },
];

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configuração do SDR-Next"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SECTIONS.map(({ href, label, desc, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="card hover:border-brand-600/50 hover:bg-zinc-800/80 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-md bg-brand-600/15 border border-brand-600/30 flex items-center justify-center">
                <Icon className="h-4 w-4 text-brand-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-100">{label}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{desc}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
