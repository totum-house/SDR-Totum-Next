import Link from 'next/link';
import { Upload } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { NotConfigured } from '@/components/NotConfigured';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STATUS = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;
const PAGE_SIZE = 50;

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Telefone só-dígitos vira legível: 5531999990001 → +55 31 99999-0001 */
function fmtPhone(digits: string) {
  const m = String(digits).match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  if (!m) return digits;
  return `+${m[1]} ${m[2]} ${m[3]}-${m[4]}`;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q = '', status = '', page = '1' } = await searchParams;
  const supabase = getSupabase();

  if (!supabase) {
    return (
      <div>
        <PageHeader title="Leads" subtitle="Base de leads do workspace" />
        <NotConfigured />
      </div>
    );
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const from = (pageNum - 1) * PAGE_SIZE;

  let query = supabase
    .from('leads')
    .select('id, phone_e164, name, status, source, metadata, created_at', { count: 'exact' })
    .eq('workspace_id', WORKSPACE_ID)
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (status && STATUS.includes(status as (typeof STATUS)[number])) {
    query = query.eq('status', status);
  }
  if (q.trim()) {
    // Busca por nome OU telefone. `%` no meio porque o operador digita o
    // pedaço que lembra — raramente o número inteiro com DDI.
    const term = q.trim().replace(/[%,]/g, '');
    query = query.or(`name.ilike.%${term}%,phone_e164.ilike.%${term}%`);
  }

  const { data, count, error } = await query;
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const linkWith = (patch: Record<string, string>) => {
    const sp = new URLSearchParams({ q, status, page: String(pageNum), ...patch });
    for (const [k, v] of Array.from(sp.entries())) if (!v) sp.delete(k);
    return `/leads?${sp.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle={`${total.toLocaleString('pt-BR')} lead(s) na base`}
        actions={
          <Link href="/leads/import" className="btn-primary">
            <Upload className="h-4 w-4" />
            Importar CSV
          </Link>
        }
      />

      <form method="GET" className="card mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">Buscar</label>
          <input
            name="q"
            defaultValue={q}
            placeholder="nome ou telefone"
            className="w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">Status</label>
          <select
            name="status"
            defaultValue={status}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
          >
            <option value="">todos</option>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-ghost border border-zinc-700">
          Filtrar
        </button>
        {q || status ? (
          <Link href="/leads" className="text-xs text-zinc-500 hover:text-zinc-300">
            limpar
          </Link>
        ) : null}
      </form>

      {error ? (
        <div className="card border-brand-700/50 text-sm text-brand-300">
          Erro ao consultar leads: {error.message}
        </div>
      ) : (data || []).length === 0 ? (
        <div className="card text-sm text-zinc-500">
          {q || status ? (
            'Nenhum lead com esses filtros.'
          ) : (
            <>
              Base vazia.{' '}
              <Link href="/leads/import" className="text-brand-400 underline">
                Importar um CSV
              </Link>{' '}
              para começar.
            </>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2 font-medium">Telefone</th>
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Tags</th>
                <th className="px-4 py-2 font-medium">Origem</th>
                <th className="px-4 py-2 font-medium">Entrou em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {(data || []).map((lead) => {
                const tags = (lead.metadata as { tags?: string[] })?.tags || [];
                return (
                  <tr key={lead.id} className="hover:bg-zinc-800/40">
                    <td className="px-4 py-2 font-mono text-xs text-zinc-300">
                      {fmtPhone(lead.phone_e164)}
                    </td>
                    <td className="px-4 py-2 text-zinc-200">{lead.name || '—'}</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-400">
                      {tags.length ? tags.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500">{lead.source || '—'}</td>
                    <td className="px-4 py-2 text-xs text-zinc-500">{fmtDate(lead.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lastPage > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-xs text-zinc-500">
            página {pageNum} de {lastPage}
          </span>
          <div className="flex gap-2">
            {pageNum > 1 ? (
              <Link href={linkWith({ page: String(pageNum - 1) })} className="btn-ghost border border-zinc-700">
                anterior
              </Link>
            ) : null}
            {pageNum < lastPage ? (
              <Link href={linkWith({ page: String(pageNum + 1) })} className="btn-ghost border border-zinc-700">
                próxima
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
