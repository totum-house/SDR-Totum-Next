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

const express = require('express');

const PORT = Number(process.env.MOTOR_PORT || 3100);
const BIND = process.env.MOTOR_BIND || '127.0.0.1';
const WEBHOOK_TOKEN = process.env.OPENWA_WEBHOOK_TOKEN || '';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', pid: process.pid, uptime_s: Math.round(process.uptime()) });
});

app.post('/api/webhook/openwa', (req, res) => {
  const auth = req.get('Authorization') || '';
  if (!WEBHOOK_TOKEN || auth !== `Bearer ${WEBHOOK_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  // TODO fase 4+: enfileirar evento pro processor (brain.js + flow_runner)
  // Por enquanto só aceita e loga; processor é integrado depois via fila.
  console.log('[webhook] openwa event:', JSON.stringify(req.body).slice(0, 300));
  res.json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, BIND, () => {
    console.log(`[motor] escutando em http://${BIND}:${PORT}`);
  });
}

module.exports = app;
