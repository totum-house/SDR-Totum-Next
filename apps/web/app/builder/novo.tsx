'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

export function NovoFlowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function criar() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Novo flow' }),
      });
      const data = await res.json();
      if (res.ok) router.push(`/builder/${data.flow.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={criar} disabled={busy} className="btn-primary disabled:opacity-40">
      <Plus className="h-4 w-4" />
      {busy ? 'Criando…' : 'Novo flow'}
    </button>
  );
}
