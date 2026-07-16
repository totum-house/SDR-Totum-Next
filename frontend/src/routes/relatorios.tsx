import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { TrendingUp, TrendingDown, Users, CheckCircle2, DollarSign, Clock } from "lucide-react";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios · SDR TOTUM NEXT" },
      { name: "description", content: "Performance do SDR IA — leads qualificados, conversão, custo por lead e latência." },
    ],
  }),
  component: Page,
});

const kpis = [
  { label: "Leads Qualificados", value: "15", delta: "+22%", up: true, icon: CheckCircle2 },
  { label: "Conversão", value: "10%", delta: "+2.1pp", up: true, icon: TrendingUp },
  { label: "Leads processados", value: "142", delta: "+18%", up: true, icon: Users },
  { label: "Custo por lead", value: "$0.11", delta: "-14%", up: true, icon: DollarSign },
  { label: "Latência média", value: "1.4s", delta: "+0.2s", up: false, icon: Clock },
];

function Page() {
  return (
    <AppLayout>
      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <header>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Módulo</div>
          <h1 className="text-3xl text-white mt-1" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
            Relatórios de Performance
          </h1>
          <p className="text-sm text-[#d1cece] mt-2">Últimos 7 dias · Campanha Q3 SaaS Mid-Market</p>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {kpis.map((k) => {
            const Icon = k.icon;
            const good = k.up;
            const color = good ? "#35a670" : "#f59e0b";
            const Trend = good ? TrendingUp : TrendingDown;
            return (
              <div key={k.label} className="totum-card totum-card-hover !p-5 !rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="h-8 w-8 rounded-lg bg-[#1f192a] flex items-center justify-center">
                    <Icon className="h-4 w-4 text-[#ef9a9a]" />
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px]" style={{ color }}>
                    <Trend className="h-3 w-3" /> {k.delta}
                  </span>
                </div>
                <div className="mt-4 text-3xl text-white" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
                  {k.value}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
              </div>
            );
          })}
        </section>

        <section className="grid lg:grid-cols-3 gap-6">
          <div className="totum-card lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-xl" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
                Qualificações por dia
              </h2>
              <div className="flex items-center gap-2">
                <span className="totum-badge">7d</span>
                <span className="totum-badge">30d</span>
              </div>
            </div>
            <div className="h-48 flex items-end gap-2">
              {[38, 52, 44, 61, 48, 72, 66].map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-lg"
                    style={{
                      height: `${v}%`,
                      background: "linear-gradient(180deg, #e3433e, #da2128)",
                      boxShadow: "0 0 40px -12px #da2128",
                    }}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][i]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="totum-brand-card">
            <div className="text-[11px] uppercase tracking-widest text-[#ef9a9a]">Insight TARS</div>
            <h3 className="text-white text-2xl mt-2" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
              +22% de MQLs esta semana
            </h3>
            <p className="text-sm text-[#d1cece] mt-3">
              A troca de modelo para <strong>gpt-4o-mini</strong> no Agente Qualificador reduziu o custo/lead em 14% mantendo a taxa de conversão.
            </p>
            <button className="totum-btn-secondary mt-5 text-sm">Ver detalhes</button>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
