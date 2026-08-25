import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  // ReactNode e não string: várias telas põem link ou <strong> no
  // subtítulo (ex: "flow X · status RUNNING").
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">{title}</h1>
        {subtitle ? <p className="text-sm text-zinc-400 mt-1">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
