'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare,
  GitBranch,
  Users,
  Settings,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '/console',  label: 'Console',   icon: MessageSquare },
  { href: '/flows',    label: 'Flows',     icon: GitBranch },
  { href: '/leads',    label: 'Leads',     icon: Users },
  { href: '/settings', label: 'Settings',  icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-brand-600 flex items-center justify-center">
            <Activity className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">SDR-Next</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Totum BuildOps</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'bg-brand-600/15 text-brand-400 border border-brand-600/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-zinc-800 text-[10px] text-zinc-500">
        <div>Motor: <span className="text-zinc-300 font-mono">127.0.0.1:3100</span></div>
        <div>OpenWA: <span className="text-zinc-300 font-mono">127.0.0.1:3000</span></div>
      </div>
    </aside>
  );
}
