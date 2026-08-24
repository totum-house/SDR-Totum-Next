/**
 * server.js — Motor SDR HTTP server (Node CJS, bind 127.0.0.1:3100).
 *
 * Endpoints:
 *   GET  /health                  → healthcheck
 *   POST /api/webhook/openwa      → recebe evento inbound do OpenWA (validado por token)
 *   POST /api/dispatch/:leadId    → força um step do flow para o lead (dispatch manual)
 *
 * Segurança:
 *   - Bind exclusivo 127.0.0.1 (D-017)
 *   - Webhook valida Authorization: Bearer <OPENWA_WEBHOOK_TOKEN>
 *
 * Persistência: chama Supabase self-hosted via @supabase/supabase-js. Stubs
 * quando envs faltam (útil para smoke test local sem banco).
 */

const crypto = require('node:crypto');
const express = require('express');

const { getSupabaseClient } = require('./supabase_client');
const openwa = require('./openwa_client');
const { handleInboundEvent, dispatchToLead } = require('./webhook_handler');

const PORT = Number(process.env.MOTOR_PORT || 3100);
const BIND = process.env.MOTOR_BIND || '127.0.0.1';
const WEBHOOK_TOKEN = process.env.OPENWA_WEBHOOK_TOKEN || '';
// MVP single-tenant: 1 workspace por deploy do motor. Multi-workspace por
// número OpenWA fica para fase futura (precisaria mapear DID → workspace).
const WORKSPACE_ID = process.env.MOTOR_DEFAULT_WORKSPACE_ID || '';

/**
 * Compara o header Authorization com o token esperado em tempo constante.
 *
 * `a !== b` em string faz short-circuit no primeiro byte divergente, o que
 * vaza o prefixo correto do token por timing. timingSafeEqual sempre percorre
 * o buffer inteiro. Como ele exige buffers de mesmo tamanho, o length é
 * comparado antes — o tamanho do token não é segredo, o conteúdo é.
 */
function isAuthorized(authHeader, token) {
  if (!token) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(authHeader || '');
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', pid: process.pid, uptime_s: Math.round(process.uptime()) });
});

app.post('/api/webhook/openwa', async (req, res) => {
  if (!isAuthorized(req.get('Authorization'), WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabase = getSupabaseClient();
  if (!supabase || !WORKSPACE_ID) {
    console.log(
      '[webhook] supabase/MOTOR_DEFAULT_WORKSPACE_ID não configurado — stub mode, evento só logado:',
      JSON.stringify(req.body).slice(0, 300)
    );
    return res.json({ ok: true, stubbed: true });
  }

  try {
    const result = await handleInboundEvent({
      body: req.body,
      workspaceId: WORKSPACE_ID,
      supabase,
      openwa,
    });
    res.json(result);
  } catch (err) {
    console.error('[webhook] erro processando evento:', err.message);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

app.post('/api/dispatch/:leadId', async (req, res) => {
  if (!isAuthorized(req.get('Authorization'), WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabase = getSupabaseClient();
  if (!supabase || !WORKSPACE_ID) {
    return res.status(503).json({ error: 'not_configured' });
  }

  try {
    const result = await dispatchToLead({
      leadId: req.params.leadId,
      workspaceId: WORKSPACE_ID,
      supabase,
      openwa,
    });
    if (!result.ok) {
      const code = result.error === 'lead_not_found' ? 404 : 409;
      return res.status(code).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[dispatch] erro:', err.message);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, BIND, () => {
    console.log(`[motor] escutando em http://${BIND}:${PORT}`);
  });
}

module.exports = app;
module.exports.isAuthorized = isAuthorized;
