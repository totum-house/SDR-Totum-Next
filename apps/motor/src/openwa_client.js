/**
 * openwa_client.js — client HTTP para o gateway OpenWA (wa-automate), envio de mensagem.
 *
 * Contrato ASSUMIDO (stub — a validar contra o gateway real rodando,
 * mesmo espírito de manus_client.js / docs/MANUS_API.md):
 *   POST {OPENWA_URL}/sendText { to: "<phone>@c.us", text: "<msg>" }
 *   Header opcional: x-api-key: <OPENWA_API_KEY ou OPENWA_WEBHOOK_TOKEN>
 *
 * Se a API real divergir (endpoint, header, payload), ajustar aqui e
 * documentar em docs/OPENWA_API.md no mesmo commit.
 *
 * Envs:
 *   OPENWA_URL        default http://127.0.0.1:3000
 *   OPENWA_API_KEY    opcional; cai pra OPENWA_WEBHOOK_TOKEN se ausente
 */

const axios = require('axios');

const OPENWA_URL = process.env.OPENWA_URL || 'http://127.0.0.1:3000';
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || process.env.OPENWA_WEBHOOK_TOKEN || '';

async function sendMessage(phoneE164, text) {
  if (!phoneE164 || !text) {
    throw new Error('openwa_client: phoneE164 e text são obrigatórios');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (OPENWA_API_KEY) headers['x-api-key'] = OPENWA_API_KEY;
  const to = String(phoneE164).includes('@') ? phoneE164 : `${phoneE164}@c.us`;

  const { data } = await axios.post(
    `${OPENWA_URL}/sendText`,
    { to, text },
    { headers, timeout: 10000 }
  );
  return data;
}

module.exports = { sendMessage };
