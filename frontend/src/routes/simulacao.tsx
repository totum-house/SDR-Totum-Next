import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/simulacao")({
  head: () => ({
    meta: [
      { title: "Simulação · SDR TOTUM NEXT" },
      { name: "description", content: "Testador integrado ao Flow Builder — valide agentes SDR antes do Gate Laranja." },
    ],
  }),
  component: Redirect,
});

function Redirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/", search: { sim: 1 } as never, replace: true });
  }, [navigate]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
      Abrindo simulação no Flow Builder…
    </div>
  );
}
