'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, OctagonX } from 'lucide-react';

type ConfigData = {
  configured: boolean;
  defaults: Record<string, unknown>;
  overrides: Record<string, unknown>;
};

const DIAS = [
  { n: 1, label: 'seg' },
  { n: 2, label: 'ter' },
  { n: 3, label: 'qua' },
  { n: 4, label: 'qui' },
  { n: 5, label: 'sex' },
  { n: 6, label: 'sáb' },
  { n: 7, label: 'dom' },
];

/** Valor em vigor = override do banco se existir, senão o do YAML. */
function vigente<T>(data: ConfigData | null, key: string, fallback: T): T {
  if (!data) return fallback;
  const v = data.overrides[key] ?? data.defaults[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

export function ConfigForm() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d: ConfigData) => {
        setData(d);
        setForm({
          kill_switch: vigente(d, 'kill_switch', false),
          quota_daily: vigente(d, 'quota_daily', 2),
          window_start: vigente(d, 'window_start', '08:00'),
          window_end: vigente(d, 'window_end', '18:00'),
          window_weekdays: vigente<number[]>(d, 'window_weekdays', [1, 2, 3, 4, 5]),
          timezone: vigente(d, 'timezone', 'America/Sao_Paulo'),
          jitter_min_s: vigente(d, 'jitter_min_s', 30),
          jitter_max_s: vigente(d, 'jitter_max_s', 120),
          tone: vigente(d, 'tone', ''),
        });
      })
      .catch((e) => setMsg({ tone: 'err', text: e.message }));
  }, []);

  function set(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
    setMsg(null);
  }

  async function save(patch?: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch ?? form),
      });
      const out = await res.json();
      if (!res.ok) {
        setMsg({ tone: 'err', text: out.message || out.error });
        return;
      }
      setMsg({
        tone: 'ok',
        text: out.motorNotified
          ? 'Salvo — o motor já está usando as novas regras.'
          : 'Salvo no banco. O motor não respondeu ao aviso; ele relê sozinho em até 10s.',
      });
    } catch (err) {
      setMsg({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="card text-sm text-zinc-500">Carregando regras…</div>;

  const killOn = form.kill_switch === true;
  const field =
    'w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100';
  const label = 'mb-1 block text-xs uppercase tracking-wider text-zinc-500';
  const dias = (form.window_weekdays as number[]) || [];

  return (
    <div className="space-y-4">
      <div
        className={`card ${killOn ? 'border-brand-700/60 bg-brand-950/30' : 'border-zinc-700'}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <OctagonX className={`h-4 w-4 ${killOn ? 'text-brand-400' : 'text-zinc-600'}`} />
              Kill switch
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              Para <strong>tudo</strong>: campanha e também resposta a quem escreveu. O motor
              obedece em menos de 30 segundos, mesmo no meio de uma espera longa.
            </p>
          </div>
          <button
            onClick={() => {
              const next = !killOn;
              set('kill_switch', next);
              // Kill switch salva sozinho, sem esperar o botão "Salvar":
              // quem aperta isso quer parar AGORA, não depois de conferir
              // o resto do formulário.
              save({ kill_switch: next });
            }}
            disabled={busy}
            className={killOn ? 'btn-ghost border border-zinc-600' : 'btn-primary'}
          >
            {killOn ? 'Retomar envios' : 'PARAR TUDO'}
          </button>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <label className={label}>Teto de mensagens por dia</label>
          <input
            type="number"
            min={0}
            value={String(form.quota_daily ?? '')}
            onChange={(e) => set('quota_daily', e.target.value)}
            className={field}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Padrão do arquivo versionado: {String(data.defaults.quota_daily ?? '—')}/dia. Subir este
            número é decisão de warm-up — o número é um VoIP DID, e volume cedo demais é o jeito
            mais rápido de perder o chip.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Início</label>
            <input
              value={String(form.window_start ?? '')}
              onChange={(e) => set('window_start', e.target.value)}
              placeholder="08:00"
              className={field}
            />
          </div>
          <div>
            <label className={label}>Fim</label>
            <input
              value={String(form.window_end ?? '')}
              onChange={(e) => set('window_end', e.target.value)}
              placeholder="18:00"
              className={field}
            />
          </div>
          <div>
            <label className={label}>Fuso</label>
            <input
              value={String(form.timezone ?? '')}
              onChange={(e) => set('timezone', e.target.value)}
              className={field}
            />
          </div>
        </div>

        <div>
          <label className={label}>Dias permitidos</label>
          <div className="flex gap-1.5">
            {DIAS.map((d) => {
              const on = dias.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  onClick={() =>
                    set(
                      'window_weekdays',
                      on ? dias.filter((x) => x !== d.n) : [...dias, d.n].sort()
                    )
                  }
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    on
                      ? 'border-brand-600/40 bg-brand-600/15 text-brand-400'
                      : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            A janela vale só para conversa iniciada pelo motor. Responder quem escreveu primeiro
            nunca é bloqueado por horário.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Espera mínima (s)</label>
            <input
              type="number"
              min={0}
              value={String(form.jitter_min_s ?? '')}
              onChange={(e) => set('jitter_min_s', e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className={label}>Espera máxima (s)</label>
            <input
              type="number"
              min={0}
              value={String(form.jitter_max_s ?? '')}
              onChange={(e) => set('jitter_max_s', e.target.value)}
              className={field}
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-zinc-500">
          Intervalo aleatório entre disparos. Cadência regular é assinatura de robô.
        </p>

        <div>
          <label className={label}>Tom padrão do SDR</label>
          <textarea
            rows={3}
            value={String(form.tone ?? '')}
            onChange={(e) => set('tone', e.target.value)}
            className={field}
          />
        </div>

        {msg ? (
          <div
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
              msg.tone === 'ok'
                ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
                : 'border-brand-800/60 bg-brand-950/30 text-brand-300'
            }`}
          >
            {msg.tone === 'ok' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {msg.text}
          </div>
        ) : null}

        <button onClick={() => save()} disabled={busy} className="btn-primary disabled:opacity-40">
          {busy ? 'Salvando…' : 'Salvar regras'}
        </button>
      </div>
    </div>
  );
}
