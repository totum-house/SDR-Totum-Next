import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Workflow, Search, PlayCircle, MessagesSquare, BarChart3, ExternalLink, Bell, Settings } from "lucide-react";
import logoWhite from "@/assets/totum-logo-white.png.asset.json";

const navItems = [
  { to: "/", label: "Flow Builder", icon: Workflow, exact: true },
  { to: "/pesquisa", label: "Central de Pesquisa", icon: Search },
  { to: "/simulacao", label: "Simulação", icon: PlayCircle },
  { to: "/conversas", label: "Conversas", icon: MessagesSquare },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { location } = useRouterState();
  const path = location.pathname;

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-[#1b1728] flex flex-col" style={{ boxShadow: "inset -1px 0 0 #1f192a" }}>
        <div className="h-[74px] flex items-center gap-3 px-6" style={{ boxShadow: "inset 0 -1px 0 #1f192a" }}>
          <img src={logoWhite.url} alt="Totum" className="h-6 w-auto" />
          <span className="text-xs text-muted-foreground tracking-wide">BUILDOPS</span>
        </div>

        <div className="px-4 py-5">
          <div className="px-2 pb-3 text-[11px] uppercase tracking-widest text-muted-foreground">
            SDR Next
          </div>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const active = item.exact ? path === item.to : path.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`totum-nav-link ${active ? "totum-nav-link-active" : ""}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto p-4">
          <div className="totum-brand-card !p-4">
            <div className="text-white text-sm mb-1" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
              SDR Totum Next
            </div>
            <div className="text-xs text-[#d1cece]">MVP · v0.1</div>
            <div className="mt-3 flex items-center gap-2">
              <span className="totum-badge-warm">Beta</span>
              <span className="totum-badge">Dark</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header
          className="h-[74px] sticky top-0 z-20 flex items-center justify-between px-8 bg-[#1b1728]/80"
          style={{ backdropFilter: "blur(24px)", boxShadow: "inset 0 -1px 0 #1f192a" }}
        >
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Totum BuildOps</span>
            <h1 className="text-lg text-white" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
              SDR TOTUM NEXT
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://buildops.grupototum.com/"
              target="_blank"
              rel="noreferrer"
              className="totum-btn-ghost inline-flex items-center gap-2 text-sm"
            >
              <span className="h-2 w-2 rounded-full bg-[#a06ff6]" />
              BuildOps Control
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button className="totum-btn-ghost !p-2" aria-label="Notifications">
              <Bell className="h-4 w-4" />
            </button>
            <button className="totum-btn-ghost !p-2" aria-label="Settings">
              <Settings className="h-4 w-4" />
            </button>
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#e3433e] to-[#da2128] flex items-center justify-center text-white text-sm">
              T
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
