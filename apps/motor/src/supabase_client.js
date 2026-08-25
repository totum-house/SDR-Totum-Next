/**
 * supabase_client.js — client Supabase self-hosted (service_role), schema totum_sdr.
 *
 * Envs:
 *   NEXT_PUBLIC_SUPABASE_URL     URL do Supabase self-hosted
 *   SUPABASE_SERVICE_ROLE_KEY    chave service_role (bypassa RLS)
 *
 * Retorna null quando qualquer env falta — permite rodar o motor em
 * modo stub (smoke test local sem banco), preservando o comportamento
 * documentado no topo de server.js.
 */

const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    db: { schema: 'totum_sdr' },
    auth: { persistSession: false },
  });
}

module.exports = { getSupabaseClient };
