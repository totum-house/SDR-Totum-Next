import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { getSupabase, WORKSPACE_ID } from '@/lib/supabase';
import { motorFetch } from '@/lib/motor';

/**
 * GET  /api/config — defaults do YAML + overrides do banco, lado a lado
 * PUT  /api/config — grava overrides em totum_sdr.rules
 *
 * A tela mostra os dois separados de propósito: saber que o teto de 2/dia
 * veio do arquivo versionado, e não de alguém que digitou 2 na UI ontem,
 * muda o que se faz com essa informação.
 *
 * O que a UI grava NUNCA afrouxa a trava. rules.js combina YAML, banco,
 * env e hard cap sempre pelo menor valor para quota, e por OU para o kill
 * switch. Isto aqui é só a superfície de escrita.
 */

const RULES_YAML = path.resolve(process.cwd(), '../../packages/config/rules.yaml');

// Chaves editáveis pela UI. `tone` e janela são texto livre; quota e kill
// switch são as duas que mexem em segurança do número.
const EDITABLE_KEYS = [
  'kill_switch',
  'quota_daily',
  'window_start',
  'window_end',
  'window_weekdays',
  'timezone',
  'jitter_min_s',
  'jitter_max_s',
  'tone',
] as const;

type EditableKey = (typeof EDITABLE_KEYS)[number];

async function readYamlDefaults(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(RULES_YAML, 'utf8');
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // YAML ausente não é erro fatal na UI: o motor tem defaults próprios,
    // e a tela ainda consegue mostrar/editar os overrides do banco.
    return {};
  }
}

export async function GET() {
  const supabase = getSupabase();
  const defaults = await readYamlDefaults();

  if (!supabase) {
    return NextResponse.json({ configured: false, defaults, overrides: {} });
  }

  const { data, error } = await supabase
    .from('rules')
    .select('key, value_json, updated_at, updated_by')
    .eq('workspace_id', WORKSPACE_ID);

  if (error) {
    return NextResponse.json({ error: 'read_failed', message: error.message }, { status: 500 });
  }

  const overrides: Record<string, unknown> = {};
  const meta: Record<string, { updated_at: string; updated_by: string | null }> = {};
  for (const row of data || []) {
    overrides[row.key] = row.value_json;
    meta[row.key] = { updated_at: row.updated_at, updated_by: row.updated_by };
  }

  return NextResponse.json({ configured: true, defaults, overrides, meta, editable: EDITABLE_KEYS });
}

/** Valor cru da UI → o tipo que a chave espera. Chave desconhecida é
 *  descartada antes de chegar aqui. */
function coerce(key: EditableKey, value: unknown): unknown {
  switch (key) {
    case 'kill_switch':
      return value === true || value === 'true' || value === 'on';
    case 'quota_daily':
    case 'jitter_min_s':
    case 'jitter_max_s': {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }
    case 'window_weekdays': {
      const arr = Array.isArray(value) ? value : String(value).split(',');
      return arr.map((d) => Number(String(d).trim())).filter((d) => d >= 1 && d <= 7);
    }
    default:
      return String(value ?? '');
  }
}

export async function PUT(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const rows: { workspace_id: string; key: string; value_json: unknown }[] = [];
  const rejected: string[] = [];

  for (const [key, raw] of Object.entries(body)) {
    if (!EDITABLE_KEYS.includes(key as EditableKey)) { rejected.push(key); continue; }
    const value = coerce(key as EditableKey, raw);
    if (value === null) { rejected.push(key); continue; }
    rows.push({ workspace_id: WORKSPACE_ID, key, value_json: value });
  }

  if (!rows.length) {
    return NextResponse.json({ error: 'nothing_to_save', rejected }, { status: 400 });
  }

  const { error } = await supabase
    .from('rules')
    .upsert(rows, { onConflict: 'workspace_id,key' });

  if (error) {
    return NextResponse.json({ error: 'save_failed', message: error.message }, { status: 500 });
  }

  // O motor cacheia rules por 10s. Avisar faz a mudança valer na hora —
  // importante quando o que mudou foi o kill switch. Falha aqui não
  // invalida o save: o cache expira sozinho em 10s de qualquer forma.
  let motorNotified = false;
  try {
    const res = await motorFetch('/api/rules/invalidate', { method: 'POST' });
    motorNotified = res.ok;
  } catch {
    motorNotified = false;
  }

  return NextResponse.json({ ok: true, saved: rows.map((r) => r.key), rejected, motorNotified });
}
