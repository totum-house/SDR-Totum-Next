'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Pause } from 'lucide-react';

/**
 * Iniciar/pausar. O clique vai para /api/campaigns/:id, que repassa ao
 * motor — quem muda o estado é ele (ver a rota, e server.js).
 */
export function CampanhaControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = status === 'running';
  const done = status === 'done';

  async function act(action: 'start' | 'pause') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === 'another_campaign_running'
            ? 'Já existe outra campanha rodando neste workspace — pause a outra primeiro.'
            : data.message || data.error || 'falha'
        );
        return;
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <span className="text-xs uppercase tracking-wider text-zinc-500">campanha concluída</span>;
  }

  return (
    <div className="flex items-center gap-3">
      {error ? <span className="max-w-xs text-xs text-brand-400">{error}</span> : null}
      {running ? (
        <button onClick={() => act('pause')} disabled={busy} className="btn-ghost border border-zinc-700">
          <Pause className="h-4 w-4" />
          {busy ? '…' : 'Pausar'}
        </button>
      ) : (
        <button onClick={() => act('start')} disabled={busy} className="btn-primary disabled:opacity-40">
          <Play className="h-4 w-4" />
          {busy ? '…' : 'Iniciar'}
        </button>
      )}
    </div>
  );
}
