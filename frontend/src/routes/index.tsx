import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { FlowBuilder } from "@/features/flow-builder/FlowBuilder";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flow Builder · SDR TOTUM NEXT" },
      { name: "description", content: "Construa fluxos de SDR com IA — arraste, conecte e publique agentes qualificadores." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppLayout>
      <FlowBuilder />
    </AppLayout>
  );
}
