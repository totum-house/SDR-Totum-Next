/**
 * server.js — Motor SDR HTTP server (Node CJS, bind 127.0.0.1:3100 por padrão).
 *
 * Endpoints:
 *   GET  /health                  → healthcheck
 *   GET  /api/status              → rules efetivas, cota do dia, campanha ativa
 *   POST /api/webhook/openwa      → recebe evento inbound do OpenWA (validado por token)
 *   POST /api/dispatch/:leadId    → força um step do flow para o lead (dispatch manual)
 *   POST /api/campaigns/:id/start → coloca a campanha em 'running'
 *   POST /api/campaigns/:id/pause → volta a campanha para 'paused'
 *   POST /api/campaigns/tick      → força uma passada do ciclo (smoke test)
 *   GET  /sse/live                → stream de eventos para o painel /live
 *
 * Segurança:
 *   - Bind padrão 127.0.0.1 (D-017), NUNCA 0.0.0.0
 *   - Webhook valida Authorization: Bearer <OPENWA_WEBHOOK_TOKEN>
 *
 * Bind extra (MOTOR_EXTRA_BIND): quando o OpenWA roda em container Docker
 * numa bridge própria (ex: openwa-network), ele NÃO enxerga 127.0.0.1 do
 * host — é outro namespace de rede. 127.0.0.1 é estritamente loopback; não
 * existe rota de container pra host através dele, mesmo com
 * host.docker.internal/extra_hosts (isso resolve o *nome*, não contorna a
 * regra do kernel de que loopback só aceita tráfego da própria máquina).
 *
 * A correção NÃO é abrir 0.0.0.0 — isso exporia o motor pra qualquer coisa
 * na máquina e potencialmente pra fora, se houver qualquer forward. A
 * correção é bindar TAMBÉM no endereço da interface bridge do Docker
 * (ex: o gateway da rede do OpenWA, tipo 10.0.16.1) — um endereço privado,
 * não roteável da internet, alcançável só pelos containers daquela bridge
 * específica. Ver apps/openwa/README.md pra como descobrir esse endereço
 * (`docker inspect openwa-api`).
 *
 * Sem MOTOR_EXTRA_BIND, o comportamento é idêntico ao de antes: só 127.0.0.1.
 *
 * Persistência: chama Supabase self-hosted via @supabase/supabase-js. Stubs
 * quando envs faltam (útil para smoke test local sem banco).
 */

const crypto = require('node:crypto');
// Carrega .env do cwd (apps/motor/.env em produção via PM2 — ver
// ecosystem.config.cjs). Nunca lança se o arquivo não existir: seguro
// também em teste/CI, onde as envs vêm direto de process.env.
require('dotenv').config();
const express = require('express');

const { getSupabaseClient } = require('./supabase_client');
const openwa = require('./openwa_client');
const { handleInboundEvent, dispatchToLead } = require('./webhook_handler');
const { createCampaignRunner } = require('./campaign_runner');
const { getRules, effectiveDailyLimit, isWithinWindow, invalidateRulesCache } = require('./rules');
const { countOutboundToday } = require('./warmup');
const { subscribe, recentEvents, emitEvent, EVENT_TYPES } = require('./events');

const PORT = Number(process.env.MOTOR_PORT || 3100);
const BIND = process.env.MOTOR_BIND || '127.0.0.1';
// Endereço adicional pra bindar (ver docstring acima). Nunca use 0.0.0.0 aqui.
const EXTRA_BIND = (process.env.MOTOR_EXTRA_BIND || '').trim();
if (EXTRA_BIND === '0.0.0.0') {
  throw new Error('server.js: MOTOR_EXTRA_BIND=0.0.0.0 não é permitido — bindaria em todas as interfaces');
}
const WEBHOOK_TOKEN = process.env.OPENWA_WEBHOOK_TOKEN || '';
// MVP single-tenant: 1 workspace por deploy do motor. Multi-workspace por
// número OpenWA fica para fase futura (precisaria mapear DID → workspace).
const WORKSPACE_ID = process.env.MOTOR_DEFAULT_WORKSPACE_ID || '';
// Desligar o laço de campanha sem desligar o motor: útil para subir uma
// instância que só recebe webhook (ex: durante debug de flow), sem risco
// de ela começar a prospectar sozinha.
const CAMPAIGN_LOOP_ENABLED =
  String(process.env.MOTOR_CAMPAIGN_LOOP || 'true').toLowerCase() !== 'false';

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

/**
 * Runner de campanha — instância única por processo, criada preguiçosamente
 * porque depende do supabase, que pode não estar configurado (modo stub).
 */
let _runner = null;
function getRunner() {
  if (_runner) return _runner;
  const supabase = getSupabaseClient();
  if (!supabase || !WORKSPACE_ID) return null;
  _runner = createCampaignRunner({ supabase, openwa, workspaceId: WORKSPACE_ID });
  return _runner;
}

/**
 * GET /api/status — o que o dashboard precisa saber em uma chamada:
 * regras efetivas, quanto da cota já foi usada hoje, se está dentro da
 * janela, qual campanha está rodando.
 *
 * Devolve `quota.used` do banco em vez de um contador em memória: se o
 * motor reiniciou no meio do dia, o contador em memória mentiria — e
 * mentir para menos, no caso da cota, é o erro caro.
 */
app.get('/api/status', async (req, res) => {
  if (!isAuthorized(req.get('Authorization'), WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const supabase = getSupabaseClient();
  if (!supabase || !WORKSPACE_ID) {
    return res.json({ configured: false, motor: 'stub' });
  }
  try {
    const rules = await getRules({ supabase, workspaceId: WORKSPACE_ID });
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, name, status, quota_daily, started_at')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'running')
      .limit(1)
      .maybeSingle();
    const used = await countOutboundToday(supabase, WORKSPACE_ID);
    const limit = effectiveDailyLimit({ rules, campaign });
    const window = isWithinWindow(rules, new Date());

    res.json({
      configured: true,
      workspace_id: WORKSPACE_ID,
      kill_switch: Boolean(rules.kill_switch),
      mock_send: openwa.isMockSend(),
      campaign_loop: CAMPAIGN_LOOP_ENABLED && Boolean(getRunner()?.isRunning()),
      quota: { used, limit, remaining: Math.max(0, limit - used) },
      window: { allowed: window.allowed, reason: window.reason || null, local: window.local },
      rules: {
        window_start: rules.window_start,
        window_end: rules.window_end,
        window_weekdays: rules.window_weekdays,
        timezone: rules.timezone,
        jitter_min_s: rules.jitter_min_s,
        jitter_max_s: rules.jitter_max_s,
        tone: rules.tone,
        sources: rules.__sources,
      },
      campaign: campaign || null,
    });
  } catch (err) {
    console.error('[status] erro:', err.message);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * POST /api/campaigns/:id/start | /pause
 *
 * O motor é dono da transição de estado, não o painel: o índice parcial
 * uq_campaigns_one_running já garante uma campanha rodando por workspace,
 * então um segundo 'start' volta como 409 do próprio banco em vez de
 * virar duas campanhas disputando a mesma cota.
 */
async function setCampaignStatus(req, res, status) {
  if (!isAuthorized(req.get('Authorization'), WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const supabase = getSupabaseClient();
  if (!supabase || !WORKSPACE_ID) return res.status(503).json({ error: 'not_configured' });

  const patch = status === 'running'
    ? { status, started_at: new Date().toISOString(), stopped_at: null }
    : { status, stopped_at: new Date().toISOString() };

  const { data, error } = await supabase
    .from('campaigns')
    .update(patch)
    .eq('id', req.params.id)
    .eq('workspace_id', WORKSPACE_ID)
    .select()
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation → já existe outra campanha 'running'.
    const conflict = error.code === '23505';
    return res.status(conflict ? 409 : 500).json({
      error: conflict ? 'another_campaign_running' : 'internal',
      message: error.message,
    });
  }
  if (!data) return res.status(404).json({ error: 'campaign_not_found' });

  emitEvent(
    status === 'running' ? EVENT_TYPES.CAMPAIGN_STARTED : EVENT_TYPES.CAMPAIGN_PAUSED,
    { campaign_id: data.id, name: data.name }
  );
  res.json({ ok: true, campaign: data });
}

app.post('/api/campaigns/:id/start', (req, res) => setCampaignStatus(req, res, 'running'));
app.post('/api/campaigns/:id/pause', (req, res) => setCampaignStatus(req, res, 'paused'));

/**
 * POST /api/campaigns/tick — força uma passada do ciclo, sem esperar o
 * jitter. É o que torna o smoke test end-to-end viável em minutos em vez
 * de horas. Não pula NENHUMA trava: kill switch, janela e cota valem
 * igual — só a espera é pulada.
 */
app.post('/api/campaigns/tick', async (req, res) => {
  if (!isAuthorized(req.get('Authorization'), WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const runner = getRunner();
  if (!runner) return res.status(503).json({ error: 'not_configured' });
  try {
    const result = await runner.tick();
    const { rules, campaign, ...rest } = result;
    res.json({ ok: true, ...rest, campaign_id: campaign?.id || null });
  } catch (err) {
    console.error('[campanha] erro no tick manual:', err.message);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/** POST /api/rules/invalidate — a UI /config chama depois de salvar,
 *  para a mudança valer na hora em vez de esperar o TTL de 10s. */
app.post('/api/rules/invalidate', (req, res) => {
  if (!isAuthorized(req.get('Authorization'), WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  invalidateRulesCache();
  res.json({ ok: true });
});

/**
 * GET /sse/live — stream de eventos do motor para o painel.
 *
 * Detalhes que não são opcionais aqui:
 *  - `X-Accel-Buffering: no` desliga o buffer do nginx; sem isso o proxy
 *    segura os eventos e o "tempo real" chega em blocos de minutos.
 *  - heartbeat de comentário (`:hb`) a cada 25s: proxies e balanceadores
 *    fecham conexão ociosa por volta de 30-60s, e um SSE em warm-up pode
 *    ficar horas sem evento nenhum.
 *  - replay do ring buffer na abertura: o painel recém-aberto mostra o
 *    que já aconteceu em vez de uma tela vazia.
 */
app.get('/sse/live', (req, res) => {
  if (!isAuthorized(req.get('Authorization'), WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event) => {
    res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  res.write(': conectado ao motor\n\n');
  for (const event of recentEvents(30)) send(event);

  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => res.write(': hb\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

if (require.main === module) {
  const http = require('node:http');
  http.createServer(app).listen(PORT, BIND, () => {
    console.log(`[motor] escutando em http://${BIND}:${PORT}`);
  });
  if (EXTRA_BIND) {
    http.createServer(app).listen(PORT, EXTRA_BIND, () => {
      console.log(`[motor] escutando também em http://${EXTRA_BIND}:${PORT} (bridge Docker)`);
    });
  }

  // O laço só sobe se houver banco e workspace. Sem isso o motor fica em
  // modo stub (webhook logado, nada persistido) — subir um loop que
  // falharia em toda query só encheria o log de erro.
  if (CAMPAIGN_LOOP_ENABLED) {
    const runner = getRunner();
    if (runner) {
      runner.start();
    } else {
      console.log('[campanha] loop NÃO iniciado — supabase/MOTOR_DEFAULT_WORKSPACE_ID ausente');
    }
  } else {
    console.log('[campanha] loop desativado por MOTOR_CAMPAIGN_LOOP=false');
  }
}

module.exports = app;
module.exports.isAuthorized = isAuthorized;
module.exports.getRunner = getRunner;
