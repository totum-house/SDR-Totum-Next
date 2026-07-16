import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { UploadCloud, FileSpreadsheet, FileText, CheckCircle2, MoreHorizontal } from "lucide-react";

export const Route = createFileRoute("/pesquisa")({
  head: () => ({
    meta: [
      { title: "Central de Pesquisa · SDR TOTUM NEXT" },
      { name: "description", content: "Importe leads em XLS ou Markdown e valide a separação por lead antes de conectar ao fluxo." },
    ],
  }),
  component: Page,
});

const leads = [
  { name: "Camila Ferraz", role: "Head of Growth", company: "SaaSCo", email: "camila@saasco.com", status: "Validado" },
  { name: "Marcos Lin", role: "VP Sales", company: "Tektron", email: "marcos@tektron.io", status: "Validado" },
  { name: "Luísa Prado", role: "Founder", company: "Norte Labs", email: "luisa@nortelabs.co", status: "Validado" },
  { name: "Diego Ramos", role: "Diretor Comercial", company: "PayFlex", email: "diego@payflex.com", status: "Duplicado" },
  { name: "Ana Beatriz", role: "Head of RevOps", company: "Onda", email: "ana@onda.app", status: "Validado" },
];

function Page() {
  return (
    <AppLayout>
      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <header>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Módulo</div>
          <h1 className="text-3xl text-white mt-1" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
            Central de Pesquisa
          </h1>
          <p className="text-sm text-[#d1cece] mt-2 max-w-2xl">
            Importe listas de leads em <strong>XLS</strong> ou <strong>Markdown</strong>. Validamos formato, deduplicamos e separamos por lead
            para conectar ao Flow Builder.
          </p>
        </header>

        {/* Upload */}
        <section className="totum-card totum-card-hover">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white text-xl" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
              Importar leads
            </h2>
            <div className="flex items-center gap-2">
              <span className="totum-badge">XLS</span>
              <span className="totum-badge">MD</span>
            </div>
          </div>

          <div
            className="rounded-2xl p-10 flex flex-col items-center justify-center text-center"
            style={{
              backgroundColor: "#0e0918",
              boxShadow: "inset 0 0 0 1px hsla(0,0%,100%,0.08)",
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 12px, hsla(0,0%,100%,0.02) 12px 13px)",
            }}
          >
            <div className="h-12 w-12 rounded-full bg-[#1b1728] flex items-center justify-center mb-4"
                 style={{ boxShadow: "inset 0 0 0 1px hsla(0,0%,100%,0.1)" }}>
              <UploadCloud className="h-5 w-5 text-[#ef9a9a]" />
            </div>
            <h3 className="text-white" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
              Arraste e solte seu arquivo aqui
            </h3>
            <p className="text-xs text-muted-foreground mt-1">ou selecione manualmente — até 10MB</p>
            <button className="totum-btn-primary mt-5 inline-flex items-center gap-2 text-sm">
              <UploadCloud className="h-4 w-4" /> Upload XLS/MD
            </button>
          </div>
        </section>

        {/* Leads list */}
        <section className="totum-card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-white text-xl" style={{ fontWeight: 300, letterSpacing: "-0.02em" }}>
                Leads importados
              </h2>
              <p className="text-xs text-muted-foreground mt-1">Última importação: hoje · 142 registros · 3 duplicados removidos</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="totum-badge inline-flex items-center gap-1.5">
                <FileSpreadsheet className="h-3 w-3" /> leads-q3.xlsx
              </span>
              <span className="totum-badge inline-flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> icp-notes.md
              </span>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ boxShadow: "inset 0 0 0 1px hsla(0,0%,100%,0.08)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground bg-[#0e0918]">
                  <th className="px-4 py-3 font-normal">Lead</th>
                  <th className="px-4 py-3 font-normal">Cargo</th>
                  <th className="px-4 py-3 font-normal">Empresa</th>
                  <th className="px-4 py-3 font-normal">Status</th>
                  <th className="px-4 py-3 font-normal w-10"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.email} className="hover:bg-[#272333] transition-colors" style={{ boxShadow: "inset 0 1px 0 hsla(0,0%,100%,0.04)" }}>
                    <td className="px-4 py-3">
                      <div className="text-white">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{l.email}</div>
                    </td>
                    <td className="px-4 py-3 text-[#d1cece]">{l.role}</td>
                    <td className="px-4 py-3 text-[#d1cece]">{l.company}</td>
                    <td className="px-4 py-3">
                      {l.status === "Validado" ? (
                        <span className="totum-badge inline-flex items-center gap-1.5">
                          <CheckCircle2 className="h-3 w-3 text-[#35a670]" /> {l.status}
                        </span>
                      ) : (
                        <span className="totum-badge-warm">{l.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
