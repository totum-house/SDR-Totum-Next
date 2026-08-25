import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';
import { leadsFromCsv } from '@/lib/csv';

/**
 * POST /api/leads/import — importa leads de um CSV.
 *
 * Aceita `multipart/form-data` com o campo `file`, ou `text/csv` no corpo.
 *
 * Colunas reconhecidas (case-insensitive, com sinônimos em português):
 *   phone | telefone | celular | whatsapp   ← obrigatória
 *   name  | nome
 *   tags  | tag                              ← "a;b;c"
 *
 * DEDUPLICAÇÃO: o insert usa upsert com onConflict (workspace_id,
 * phone_e164) e ignoreDuplicates. Reimportar a mesma lista não cria lead
 * repetido nem sobrescreve o que já existe — em particular, não apaga o
 * `status` de um lead que já virou 'qualified' só porque ele apareceu de
 * novo numa planilha antiga.
 *
 * LOTES de 500: o PostgREST tem limite de tamanho de payload, e uma
 * lista de 5 mil leads num único insert volta 413. O lote também deixa o
 * erro localizável quando uma linha específica é rejeitada.
 */

const BATCH_SIZE = 500;

// Teto de tamanho do arquivo. Import é operação de operador, não de
// público — mas um upload de 200MB derrubaria o processo do Next antes
// de qualquer validação rodar.
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  let csvText = '';
  const contentType = req.headers.get('content-type') || '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') {
        return NextResponse.json({ error: 'file_missing' }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: 'file_too_large', max_bytes: MAX_BYTES }, { status: 413 });
      }
      csvText = await file.text();
    } else {
      csvText = await req.text();
      if (csvText.length > MAX_BYTES) {
        return NextResponse.json({ error: 'file_too_large', max_bytes: MAX_BYTES }, { status: 413 });
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'unreadable_body', message: (err as Error).message },
      { status: 400 }
    );
  }

  const preview = leadsFromCsv(csvText);
  if (preview.valid.length === 0) {
    return NextResponse.json(
      { error: 'no_valid_rows', invalid: preview.invalid.slice(0, 20) },
      { status: 422 }
    );
  }

  const rows = preview.valid.map((lead) => ({
    workspace_id: WORKSPACE_ID,
    phone_e164: lead.phone_e164,
    name: lead.name,
    source: 'csv_import',
    // `tags` não é coluna na 001 — vai em metadata, que é JSONB livre.
    metadata: lead.tags.length ? { tags: lead.tags } : {},
  }));

  let imported = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('leads')
      .upsert(batch, { onConflict: 'workspace_id,phone_e164', ignoreDuplicates: true })
      .select('id');
    if (error) {
      return NextResponse.json(
        {
          error: 'insert_failed',
          message: error.message,
          imported_before_failure: imported,
          batch_start_line: i + 2,
        },
        { status: 500 }
      );
    }
    imported += data?.length || 0;
  }

  return NextResponse.json({
    ok: true,
    imported,
    // parsed - imported = leads que já existiam (upsert ignorou)
    parsed: preview.valid.length,
    already_existed: preview.valid.length - imported,
    duplicates_in_file: preview.duplicatesInFile,
    invalid: preview.invalid.slice(0, 20),
    invalid_count: preview.invalid.length,
  });
}
