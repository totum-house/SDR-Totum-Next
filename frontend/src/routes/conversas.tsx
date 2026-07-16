import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Search, Send, Paperclip } from "lucide-react";

export const Route = createFileRoute("/conversas")({
  head: () => ({
    meta: [
      { title: "Conversas · SDR TOTUM NEXT" },
      { name: "description", content: "Interface de conversas do SDR — histórico de qualificação por lead em tempo real." },
    ],
  }),
  component: Page,
});

const threads = [
  { id: "t1", name: "Camila Ferraz", preview: "Faz sentido conversar sim, terça 14h?", tag: "MQL", time: "12:04" },
  { id: "t2", name: "Marcos Lin", preview: "Me manda o material antes por favor.", tag: "Nutrir", time: "11:58" },
  { id: "t3", name: "Luísa Prado", preview: "Já usamos algo parecido, obrigada!", tag: "Perdido", time: "10:22" },
  { id: "t4", name: "Ana Beatriz", preview: "Qual o ticket médio do plano Pro?", tag: "MQL", time: "09:47" },
];

function Page() {
  return (
    <AppLayout>
      <div className="p-8">
        <header className="mb-6">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Módulo</div>
          <h1 className="text-3xl text-white mt-1" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
            Interface de Conversas
          </h1>
          <p className="text-sm text-[#d1cece] mt-2">Acompanhe os diálogos do SDR em tempo real por lead.</p>
        </header>

        <div className="grid grid-cols-[320px_1fr] gap-6 h-[calc(100vh-260px)]">
          {/* Threads list */}
          <div className="totum-card !p-0 flex flex-col overflow-hidden">
            <div className="p-4" style={{ boxShadow: "inset 0 -1px 0 hsla(0,0%,100%,0.06)" }}>
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input placeholder="Buscar conversa…" className="totum-input flex-1 text-sm" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threads.map((t, i) => (
                <button
                  key={t.id}
                  className={`w-full text-left p-4 hover:bg-[#272333] transition-colors ${i === 0 ? "bg-[#272333]" : ""}`}
                  style={{ boxShadow: "inset 0 -1px 0 hsla(0,0%,100%,0.04)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm">{t.name}</span>
                    <span className="text-[11px] text-muted-foreground">{t.time}</span>
                  </div>
                  <div className="text-xs text-[#d1cece] mt-1 truncate">{t.preview}</div>
                  <div className="mt-2">
                    <span className={t.tag === "MQL" ? "totum-badge-warm" : "totum-badge"}>{t.tag}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Chat */}
          <div className="totum-card !p-0 flex flex-col overflow-hidden">
            <div className="p-5 flex items-center justify-between" style={{ boxShadow: "inset 0 -1px 0 hsla(0,0%,100%,0.06)" }}>
              <div>
                <div className="text-white" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>Camila Ferraz</div>
                <div className="text-xs text-muted-foreground">Head of Growth · SaaSCo</div>
              </div>
              <span className="totum-badge-warm">MQL · score 82</span>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <Bubble side="in" text="Oi! Vi o material de vocês sobre pipeline de SDR, faz sentido conversar?" />
              <Bubble side="out" text="Oi Camila! Faz total. Rapidinho: hoje quantos SDRs vocês têm no time?" />
              <Bubble side="in" text="Somos 4 SDRs e 2 AEs." />
              <Bubble side="out" text="Perfeito. Você tem 20 min terça 14h? Te mostro como o SDR Next reduz ~40% do CPL." />
              <Bubble side="in" text="Faz sentido conversar sim, terça 14h?" />
            </div>

            <div className="p-4 flex items-center gap-2" style={{ boxShadow: "inset 0 1px 0 hsla(0,0%,100%,0.06)" }}>
              <button className="totum-btn-ghost !p-2" aria-label="Anexar"><Paperclip className="h-4 w-4" /></button>
              <input placeholder="Assumir controle e responder…" className="totum-input flex-1 text-sm" />
              <button className="totum-btn-primary inline-flex items-center gap-2 text-sm">
                <Send className="h-4 w-4" /> Enviar
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function Bubble({ side, text }: { side: "in" | "out"; text: string }) {
  if (side === "in") {
    return (
      <div className="flex">
        <div className="max-w-[70%] rounded-2xl rounded-tl-sm px-4 py-2.5 bg-[#1f192a] text-[#d1cece] text-sm">
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-white text-sm"
           style={{ background: "linear-gradient(135deg,#e3433e,#da2128)" }}>
        {text}
      </div>
    </div>
  );
}
