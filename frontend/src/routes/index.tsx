import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { FlowBuilder } from "@/features/flow-builder/FlowBuilder";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { sim?: 1 } => ({
    sim: search.sim === 1 || search.sim === "1" ? 1 : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Flow Builder · SDR TOTUM NEXT" },
      { name: "description", content: "Construa fluxos de SDR com IA — arraste, conecte e publique agentes qualificadores." },
    ],
  }),
  component: Page,
});

function Page() {
  const { sim } = Route.useSearch();
  return (
    <AppLayout>
      <FlowBuilder autoSim={sim === 1} />
    </AppLayout>
  );
}
