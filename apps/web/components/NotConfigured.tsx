/**
 * Estado de "faltam variáveis de ambiente" — não é erro, é o painel
 * rodando antes do setup terminar. Mostrar o que falta economiza uma
 * viagem ao README.
 */
export function NotConfigured({ what = 'o banco' }: { what?: string }) {
  return (
    <div className="card border-amber-700/40 bg-amber-950/20">
      <div className="text-sm font-medium text-amber-300">Painel sem {what} configurado</div>
      <p className="mt-2 text-sm text-zinc-400">
        Preencha no <code className="font-mono text-zinc-300">.env.local</code> (dev) ou no{' '}
        <code className="font-mono text-zinc-300">/opt/sdr-next/.env</code> (VPS):
      </p>
      <ul className="mt-2 space-y-1 font-mono text-xs text-zinc-400">
        <li>NEXT_PUBLIC_SUPABASE_URL</li>
        <li>SUPABASE_SERVICE_ROLE_KEY</li>
        <li>MOTOR_DEFAULT_WORKSPACE_ID</li>
      </ul>
      <p className="mt-3 text-xs text-zinc-500">
        O UUID do workspace sai do seed — ver <code>packages/db/README.md</code>.
      </p>
    </div>
  );
}
