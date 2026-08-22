/**
 * manus_client.js — HTTP client para Manus (executor auxiliar)
 *
 * Manus roda em 127.0.0.1:8000 na VPS (manus.grupototum.com).
 * Delegação de tasks > 30s: pesquisa CNPJ, enriquecimento lead, resumo longo.
 *
 * Envs:
 *   MANUS_URL=http://127.0.0.1:8000   (default)
 *   MANUS_TOKEN=<bearer>              (obrigatório em prod)
 *
 * API assumida (a validar em FASE 6 com curl real contra Manus rodando):
 *   POST /task { objective, context, timeout_ms }
 *     → { result, meta: { duration_ms, cost_usd } }
 *
 * Se a API real for diferente, ajustar aqui e documentar em docs/MANUS_API.md.
 */

const axios = require('axios');

const MANUS_URL = process.env.MANUS_URL || 'http://127.0.0.1:8000';
const MANUS_TOKEN = process.env.MANUS_TOKEN || '';

async function callManus({ objective, context = {}, timeout_ms = 60000 }) {
  if (!objective || typeof objective !== 'string') {
    throw new Error('manus_client: objective (string) obrigatório');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (MANUS_TOKEN) headers.Authorization = `Bearer ${MANUS_TOKEN}`;

  const { data } = await axios.post(
    `${MANUS_URL}/task`,
    { objective, context, timeout_ms },
    { headers, timeout: timeout_ms + 5000 }
  );
  return data;
}

module.exports = { callManus };
