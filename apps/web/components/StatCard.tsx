import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  icon?: ReactNode;
}) {
  const toneClass = {
    neutral: 'text-zinc-100',
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-brand-400',
  }[tone];

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
        {icon ? <div className="text-zinc-600">{icon}</div> : null}
      </div>
      <div className={cn('mt-2 text-3xl font-semibold tabular-nums', toneClass)}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}
