'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  ShieldAlert,
  OctagonX,
  AlertTriangle,
  Megaphone,
  Activity,
} from 'lucide-react';

type LiveEvent = {
  seq: number;
  type: string;
  at: string;
  phone?: string;
  content?: string;
  reason?: string;
  error?: string;
  status?: string;
  name?: string;
  limit?: number;
  campaign_id?: string | null;
};

// Teto do que fica em tela. O motor já guarda 200 no ring buffer dele; a
// aba não precisa virar um log infinito que come memória durante o dia.
const MAX_ROWS = 300;

const META: Record<string, { icon: typeof ArrowUpRight; color: string; label: string }> = {
  outbound_sent: { icon: ArrowUpRight, color: 'text-emerald-400', label: 'enviada' },
  inbound_received: { icon: ArrowDownLeft, color: 'text-sky-400', label: 'recebida' },
  quota_blocked: { icon: ShieldAlert, color: 'text-amber-400', label: 'cota' },
  kill_switch: { icon: OctagonX, color: 'text-brand-400', label: 'kill switch' },
  send_error: { icon: AlertTriangle, color: 'text-brand-400', label: 'erro' },
  campaign_started: { icon: Megaphone, color: 'text-emerald-400', label: 'campanha' },
  campaign_paused: { icon: Megaphone, color: 'text-amber-400', label: 'campanha' },
  campaign_done: { icon: Megaphone, color: 'text-zinc-400', label: 'campanha' },
  campaign_tick: { icon: Activity, color: 'text-zinc-500', label: 'ciclo' },
};

function fmtHora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour12: false });
}

function descreve(ev: LiveEvent) {
  switch (ev.type) {
    case 'outbound_sent':
      return ev.content || '';
    case 'inbound_received':
      return ev.content || '';
    case 'quota_blocked':
      return `envio bloqueado — teto de ${ev.limit ?? '?'} msg/dia atingido`;
    case 'kill_switch':
      return 'envio bloqueado pelo kill switch';
    case 'send_error':
      return `falha no gateway: ${ev.error || 'erro desconhecido'}`;
    case 'campaign_started':
      return `campanha "${ev.name}" iniciada`;
    case 'campaign_paused':
      return `campanha "${ev.name}" pausada`;
    case 'campaign_done':
      return `campanha "${ev.name}" concluída — fila vazia`;
    case 'campaign_tick':
      return `ciclo: ${ev.status}`;
    default:
      return ev.type;
  }
}

export function LiveFeed() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [showTicks, setShowTicks] = useState(false);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    // EventSource não aceita header Authorization — é por isso que o
    // stream passa pelo proxy /api/live/stream, que é same-origin
    // (cookie SSO vai sozinho) e guarda o token do motor no servidor.
    const source = new EventSource('/api/live/stream');

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // o browser reconecta sozinho

    const onMessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as LiveEvent;
        // O replay do ring buffer reenvia eventos a cada reconexão —
        // sem dedupe por seq a lista duplicaria a cada queda de rede.
        if (seen.current.has(ev.seq)) return;
        seen.current.add(ev.seq);
        setEvents((prev) => [ev, ...prev].slice(0, MAX_ROWS));
      } catch {
        // Linha malformada não derruba o feed.
      }
    };

    // O motor nomeia o evento (`event: outbound_sent`), então `onmessage`
    // sozinho não pega nada — cada tipo precisa de listener próprio.
    for (const type of Object.keys(META)) source.addEventListener(type, onMessage);

    return () => {
      for (const type of Object.keys(META)) source.removeEventListener(type, onMessage);
      source.close();
    };
  }, []);

  const visiveis = showTicks ? events : events.filter((e) => e.type !== 'campaign_tick');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`}
          />
          <span className="text-zinc-400">
            {connected ? 'conectado ao motor' : 'reconectando…'}
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={showTicks}
            onChange={(e) => setShowTicks(e.target.checked)}
            className="accent-brand-600"
          />
          mostrar ciclos do motor
        </label>
      </div>

      {visiveis.length === 0 ? (
        <div className="card text-sm text-zinc-500">
          Nada ainda. Em warm-up isso é normal — com teto de 2 mensagens por dia, a tela fica
          quieta a maior parte do tempo.
        </div>
      ) : (
        <div className="card divide-y divide-zinc-800 p-0">
          {visiveis.map((ev) => {
            const meta = META[ev.type] || META.campaign_tick;
            const Icon = meta.icon;
            return (
              <div key={ev.seq} className="flex items-start gap-3 px-4 py-2.5">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs uppercase tracking-wider ${meta.color}`}>
                      {meta.label}
                    </span>
                    {ev.phone ? (
                      <span className="font-mono text-xs text-zinc-500">{ev.phone}</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 break-words text-sm text-zinc-300">{descreve(ev)}</div>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                  {fmtHora(ev.at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
