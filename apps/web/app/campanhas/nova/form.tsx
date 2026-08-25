'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

type Flow = { id: string; name: string; is_active: boolean };

export function NovaCampanhaForm({
  flows,
  totalLeads,
  porStatus,
  tags,
}: {
  flows: Flow[];
  totalLeads: number;
  porStatus: Record<string, number>;
  tags: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [flowId, setFlowId] = useState(flows[0]?.id ?? '');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [limit, setLimit] = useState('');
  const [quotaDaily, setQuotaDaily] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estimativa do tamanho do segmento. É estimativa mesmo: o servidor
  // reconsulta na hora de criar, e leads podem ter entrado no meio.
  const base = status ? porStatus[status] || 0 : totalLeads;
  const estimado = limit ? Math.min(Number(limit) || 0, base) : base;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          flow_id: flowId,
          quota_daily: quotaDaily || null,
          segment: { status: status || undefined, tag: tag || undefined, limit: limit || undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || 'falha ao criar');
        return;
      }
      router.push(`/campanhas/${data.campaign.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (flows.length === 0) {
    return (
      <div className="card border-amber-700/40 bg-amber-950/20 text-sm text-zinc-300">
        Não há nenhum flow no workspace — e campanha sem script não existe.{' '}
        <Link href="/builder" className="text-brand-400 underline">
          Criar um flow primeiro
        </Link>
        .
      </div>
    );
  }

  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600';
  const label = 'mb-1 block text-xs uppercase tracking-wider text-zinc-500';

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div>
        <label className={label}>Nome</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Prospecção agosto — BH"
          className={field}
        />
      </div>

      <div>
        <label className={label}>Flow</label>
        <select value={flowId} onChange={(e) => setFlowId(e.target.value)} className={field}>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.is_active ? ' (ativo)' : ''}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="rounded-md border border-zinc-800 p-3">
        <legend className="px-1 text-xs uppercase tracking-wider text-zinc-500">Segmento</legend>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
              <option value="">todos ({totalLeads})</option>
              {Object.entries(porStatus).map(([s, n]) => (
                <option key={s} value={s}>
                  {s} ({n})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Tag</label>
            <select value={tag} onChange={(e) => setTag(e.target.value)} className={field}>
              <option value="">qualquer</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Limite</label>
            <input
              type="number"
              min={1}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="sem limite"
              className={field}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          ~{estimado.toLocaleString('pt-BR')} lead(s) entrarão na fila.
        </p>
      </fieldset>

      <div>
        <label className={label}>Cota própria (opcional)</label>
        <input
          type="number"
          min={0}
          value={quotaDaily}
          onChange={(e) => setQuotaDaily(e.target.value)}
          placeholder="herda a cota global"
          className={field}
        />
        <p className="mt-1 text-xs text-zinc-500">
          Só serve para <strong>abaixar</strong> o teto. Uma campanha nunca envia mais que a regra
          global — nem que o teto do deploy.
        </p>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-brand-800/60 bg-brand-950/30 p-3 text-sm text-brand-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-40">
          {busy ? 'Criando…' : 'Criar campanha'}
        </button>
        <span className="text-xs text-zinc-500">
          Nasce em <strong>draft</strong> — disparar é um segundo clique.
        </span>
      </div>
    </form>
  );
}
