import { PageHeader } from '@/components/PageHeader';

export default function FlowsPage() {
  return (
    <div>
      <PageHeader
        title="Flows"
        subtitle="Playbooks conversacionais em graph (nodes + edges)"
      />

      <div className="card">
        <div className="text-sm text-zinc-400">
          Lista de flows do workspace (stub). Próxima fase: builder visual dos 6 tipos de nó
          (message, question, condition, improvise_with_goal, call_manus, end).
        </div>
        <div className="mt-3 font-mono text-xs text-zinc-500">
          # spec: <span className="text-zinc-300">apps/motor/src/flow_runner.js</span>
        </div>
      </div>
    </div>
  );
}
