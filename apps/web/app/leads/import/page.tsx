'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Upload, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';

type ImportResult = {
  ok?: boolean;
  imported?: number;
  parsed?: number;
  already_existed?: number;
  duplicates_in_file?: number;
  invalid?: { line: number; raw: string; reason: string }[];
  invalid_count?: number;
  error?: string;
  message?: string;
};

export default function ImportLeadsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/leads/import', { method: 'POST', body: form });
      setResult(await res.json());
    } catch (err) {
      setResult({ error: 'network', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Importar leads"
        subtitle="CSV com as colunas phone, name e tags"
        actions={
          <Link href="/leads" className="btn-ghost border border-zinc-700">
            voltar
          </Link>
        }
      />

      <form onSubmit={submit} className="card">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 px-6 py-10 hover:border-zinc-600">
          <Upload className="h-6 w-6 text-zinc-500" />
          <span className="text-sm text-zinc-300">
            {file ? file.name : 'Escolher arquivo .csv'}
          </span>
          <span className="text-xs text-zinc-600">
            {file ? `${(file.size / 1024).toFixed(1)} KB` : 'até 5 MB'}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
        </label>

        <button type="submit" disabled={!file || busy} className="btn-primary mt-4 disabled:opacity-40">
          {busy ? 'Importando…' : 'Importar'}
        </button>
      </form>

      <div className="card mt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <FileText className="h-4 w-4" /> Formato aceito
        </div>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 font-mono text-xs text-zinc-400">
{`phone,name,tags
5531999990001,Rael,quente;bh
+55 11 99999-0002,Maria,frio`}
        </pre>
        <ul className="mt-3 space-y-1 text-xs text-zinc-500">
          <li>• A coluna do telefone pode se chamar <code>phone</code>, <code>telefone</code>, <code>celular</code> ou <code>whatsapp</code>.</li>
          <li>• Separador <code>,</code> ou <code>;</code> (Excel pt-BR) — detectado sozinho.</li>
          <li>• Telefone sem DDI recebe <code>55</code> automaticamente.</li>
          <li>• Lead que já existe é ignorado, não sobrescrito — reimportar a mesma lista é seguro.</li>
          <li>• Linha com telefone inválido não aborta o import: ela é listada no fim.</li>
        </ul>
      </div>

      {result ? (
        <div className="card mt-4">
          {result.error ? (
            <div className="flex items-start gap-2 text-sm text-brand-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Import falhou: {result.error}</div>
                {result.message ? <div className="mt-1 text-zinc-400">{result.message}</div> : null}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div className="text-zinc-300">
                <div className="font-medium text-emerald-400">
                  {result.imported} lead(s) importado(s)
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-zinc-400">
                  <li>{result.parsed} linha(s) válida(s) no arquivo</li>
                  {result.already_existed ? <li>{result.already_existed} já existia(m) na base</li> : null}
                  {result.duplicates_in_file ? (
                    <li>{result.duplicates_in_file} duplicata(s) dentro do próprio arquivo</li>
                  ) : null}
                  {result.invalid_count ? <li>{result.invalid_count} linha(s) inválida(s)</li> : null}
                </ul>
              </div>
            </div>
          )}

          {result.invalid?.length ? (
            <div className="mt-4">
              <div className="mb-1 text-xs uppercase tracking-wider text-zinc-500">
                Linhas não importadas
              </div>
              <ul className="space-y-1 font-mono text-xs text-zinc-500">
                {result.invalid.map((row) => (
                  <li key={row.line}>
                    linha {row.line}: <span className="text-zinc-400">{row.raw}</span> — {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.ok ? (
            <Link href="/leads" className="btn-ghost mt-4 border border-zinc-700">
              ver leads
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
