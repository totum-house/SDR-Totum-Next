/**
 * supabase.ts — acesso ao schema totum_sdr a partir do servidor Next.
 *
 * ⚠️ USA service_role, QUE BYPASSA RLS. Só pode ser chamado de Server
 * Component ou Route Handler — nunca de componente 'use client', senão a
 * chave vai junto no bundle do browser.
 *
 * POR QUE service_role E NÃO O JWT DO USUÁRIO
 *
 * O Supabase Auth ainda não está conectado neste app (docs/PROTOCOL_CAMADAS.md,
 * L8 — 🔴 vermelho). O middleware confere a PRESENÇA do cookie SSO, não a
 * assinatura dele. Ou seja: hoje o painel é single-tenant, exatamente como
 * o motor (MOTOR_DEFAULT_WORKSPACE_ID), e a segurança real é o painel não
 * estar exposto publicamente.
 *
 * Quando o Auth entrar, a troca é: criar o client com a anon key + o JWT
 * do usuário, e deixar as policies da 001/002 filtrarem por workspace.
 * As queries não mudam — elas já filtram por workspace_id na mão.
 */

import { createClient } from '@supabase/supabase-js';

export const WORKSPACE_ID = process.env.MOTOR_DEFAULT_WORKSPACE_ID || '';

// O tipo sai do próprio createClient em vez de `SupabaseClient` nu: o
// genérico default assume o schema 'public', e este client aponta para
// 'totum_sdr' — anotar à mão brigaria com a inferência a cada upgrade
// da lib.
function makeClient(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: 'totum_sdr' },
    auth: { persistSession: false },
  });
}

export type SdrClient = ReturnType<typeof makeClient>;

let cached: SdrClient | null = null;

/**
 * Devolve null quando falta env — as páginas mostram um aviso de
 * "não configurado" em vez de explodir com stack trace. Rodar o painel
 * sem banco é um estado legítimo durante o setup.
 */
export function getSupabase(): SdrClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !WORKSPACE_ID) return null;
  cached = makeClient(url, key);
  return cached;
}

export function isConfigured() {
  return getSupabase() !== null;
}
