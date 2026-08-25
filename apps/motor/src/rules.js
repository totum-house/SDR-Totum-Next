/**
 * rules.js — regras globais de operação: quota, kill switch, janela, ritmo.
 *
 * Junta quatro camadas de configuração, nesta ordem de precedência:
 *
 *   1. hard cap deste arquivo    HARD_DAILY_CEILING — ninguém passa
 *   2. env do deploy             WARMUP_ENABLED / WARMUP_DAILY_LIMIT
 *   3. packages/config/rules.yaml   default versionado no repo
 *   4. totum_sdr.rules (banco)      override que a UI /config escreve
 *
 * QUOTA combina pelo MENOR valor. Nem o YAML nem o banco conseguem
 * AUMENTAR o teto acima do env ou do hard cap — só abaixar. Isso não é
 * paranoia: em 2026-08-24 saíram 10 mensagens com o limite em 2, e a
 * conclusão foi que trava de volume não pode depender de config que uma
 * tela escreve. A UI pode ser mais conservadora que o deploy; o
 * contrário exige mudar env e reiniciar o motor, conscientemente.
 *
 * KILL SWITCH combina pelo OU: qualquer camada liga, nenhuma desliga a
 * da outra. Parar sempre tem que ser a operação fácil.
 *
 * CACHE: as rules são lidas do banco no máximo 1× a cada
 * RULES_CACHE_TTL_MS. É o que dá o "kill switch para tudo em menos de
 * 30s" sem transformar o loop de campanha num gerador de queries — com
 * TTL de 10s, o pior caso é 10s de cache + a fatia de espera do
 * sleepUnlessKilled (2s). Ver campaign_runner.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

// Teto absoluto de mensagens/dia por workspace. Não existe configuração,
// em lugar nenhum, que faça o motor passar disto. É o último anteparo
// entre um erro de digitação na UI e a perda do chip.
const HARD_DAILY_CEILING = 100;

const RULES_CACHE_TTL_MS = 10_000;

// Fatia de espera do sleepUnlessKilled: o motor acorda a cada 2s para
// reconferir o kill switch, mesmo no meio de um jitter de 120s.
const KILL_CHECK_SLICE_MS = 2_000;

/**
 * Defaults do código. Existem para o motor subir mesmo sem o YAML (ex:
 * deploy que só copiou apps/motor). São os valores mais conservadores
 * possíveis de propósito: se a configuração sumiu, o certo é mandar
 * menos, não mais.
 */
const CODE_DEFAULTS = {
  kill_switch: false,
  quota_daily: 2,
  window_start: '08:00',
  window_end: '18:00',
  window_weekdays: [1, 2, 3, 4, 5],
  timezone: 'America/Sao_Paulo',
  jitter_min_s: 30,
  jitter_max_s: 120,
  tone: 'Consultivo, direto e humano. Português do Brasil, mensagens curtas.',
};

// Chaves que o motor aceita do YAML/banco. Qualquer outra é ignorada —
// evita que um campo solto na tabela `rules` vire comportamento acidental.
const KNOWN_KEYS = Object.keys(CODE_DEFAULTS);

// Resolvido a cada leitura, não uma vez no require: o caminho vem de env
// e o cache de módulo do Node congelaria o valor do primeiro import.
function rulesYamlPath() {
  return (
    process.env.RULES_YAML_PATH ||
    path.resolve(__dirname, '../../../packages/config/rules.yaml')
  );
}

let _yamlCache = null;

/**
 * Lê packages/config/rules.yaml. YAML ausente ou quebrado NÃO derruba o
 * motor: cai nos CODE_DEFAULTS e avisa. Um erro de sintaxe no arquivo de
 * config não pode ser o motivo de o SDR parar de responder cliente.
 */
function loadYamlRules({ logger = console, force = false } = {}) {
  if (_yamlCache && !force) return _yamlCache;
  try {
    const raw = fs.readFileSync(rulesYamlPath(), 'utf8');
    const parsed = yaml.load(raw);
    _yamlCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    logger.warn(`[rules] rules.yaml não carregado (${err.message}) — usando defaults do código`);
    _yamlCache = {};
  }
  return _yamlCache;
}

function pickKnown(obj) {
  const out = {};
  for (const k of KNOWN_KEYS) {
    if (obj && obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  }
  return out;
}

function envDailyLimit() {
  const raw = process.env.WARMUP_DAILY_LIMIT;
  const n = Number(raw);
  if (!raw || Number.isNaN(n) || n < 0) return null;
  return n;
}

function envKillSwitch() {
  return String(process.env.WARMUP_ENABLED || 'true').toLowerCase() === 'false';
}

let _cache = { at: 0, workspaceId: null, value: null };

/**
 * Rules efetivas do workspace: YAML + banco, já reduzidas pelo env e
 * pelo hard cap.
 *
 * Falha de banco não propaga: devolve o que dá pra saber (YAML + env) e
 * loga. O motor tem que continuar operando — de forma mais restritiva,
 * nunca mais permissiva — se o Supabase estiver fora do ar.
 */
async function getRules({ supabase, workspaceId, logger = console, now = Date.now() } = {}) {
  if (
    _cache.value &&
    _cache.workspaceId === workspaceId &&
    now - _cache.at < RULES_CACHE_TTL_MS
  ) {
    return _cache.value;
  }

  const fromYaml = pickKnown(loadYamlRules({ logger }));
  let fromDb = {};

  if (supabase && workspaceId) {
    try {
      const { data, error } = await supabase
        .from('rules')
        .select('key, value_json')
        .eq('workspace_id', workspaceId);
      if (error) throw error;
      for (const row of data || []) {
        if (KNOWN_KEYS.includes(row.key)) fromDb[row.key] = row.value_json;
      }
    } catch (err) {
      logger.warn(`[rules] falha ao ler totum_sdr.rules (${err.message}) — seguindo só com YAML/env`);
      fromDb = {};
    }
  }

  const merged = { ...CODE_DEFAULTS, ...fromYaml, ...fromDb };

  // Quota: o menor de todos. `filter` remove os que não se aplicam
  // (env não setado, YAML sem a chave) em vez de tratá-los como zero.
  const quotaCandidates = [
    HARD_DAILY_CEILING,
    envDailyLimit(),
    Number(merged.quota_daily),
  ].filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  merged.quota_daily = Math.min(...quotaCandidates);

  // Kill switch: OU de todas as camadas.
  merged.kill_switch = Boolean(merged.kill_switch) || envKillSwitch();

  // Jitter incoerente (min > max) vira o par ordenado, não um erro:
  // config torta não pode virar motivo de o motor não disparar nada.
  const jMin = Number(merged.jitter_min_s);
  const jMax = Number(merged.jitter_max_s);
  merged.jitter_min_s = Math.max(0, Math.min(jMin, jMax) || 0);
  merged.jitter_max_s = Math.max(0, Math.max(jMin, jMax) || 0);

  merged.__sources = {
    hard_ceiling: HARD_DAILY_CEILING,
    env_daily_limit: envDailyLimit(),
    env_kill_switch: envKillSwitch(),
    yaml_keys: Object.keys(fromYaml),
    db_keys: Object.keys(fromDb),
  };

  _cache = { at: now, workspaceId, value: merged };
  return merged;
}

/** Descarta o cache — usado em teste e depois de a UI gravar rules. */
function invalidateRulesCache() {
  _cache = { at: 0, workspaceId: null, value: null };
  _yamlCache = null;
}

/**
 * Teto efetivo considerando também a campanha.
 *
 * `campaign.quota_daily` só ABAIXA: uma campanha não consegue pedir mais
 * cota que a global, pelo mesmo motivo que a rule não consegue pedir
 * mais que o env.
 */
function effectiveDailyLimit({ rules, campaign = null }) {
  const base = Number(rules?.quota_daily);
  const safeBase = Number.isFinite(base) && base >= 0 ? base : CODE_DEFAULTS.quota_daily;

  // `campaigns.quota_daily` é NULL por padrão no schema, e Number(null) é
  // 0 — não NaN. Sem esta guarda, "campanha sem cota própria" viraria
  // "cota zero" e nenhuma campanha enviaria nada, em silêncio.
  const raw = campaign?.quota_daily;
  if (raw === null || raw === undefined || raw === '') return safeBase;

  const perCampaign = Number(raw);
  if (Number.isFinite(perCampaign) && perCampaign >= 0) {
    return Math.min(safeBase, perCampaign);
  }
  return safeBase;
}

function isKillSwitchOn(rules) {
  return Boolean(rules?.kill_switch);
}

/**
 * Hora local do workspace, sem depender de a máquina estar no fuso certo
 * (o VPS roda em UTC). Intl faz a conversão com a tz database do sistema.
 */
function localParts(rules, date = new Date()) {
  const tz = rules?.timezone || CODE_DEFAULTS.timezone;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
  } catch {
    // Timezone inválida no config: cai pro fuso da máquina em vez de
    // explodir. Log fica a cargo de quem chama isWithinWindow.
    parts = new Intl.DateTimeFormat('en-GB', {
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
  }
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] || 0,
  };
}

function parseHHMM(s, fallbackMinutes) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallbackMinutes;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * A janela vale só para conversa iniciada pelo motor (cold outbound).
 * Responder quem escreveu primeiro nunca é bloqueado por horário — é o
 * inverso que denuncia um bot: ninguém prospecta às 3h da manhã, mas
 * gente responde mensagem fora do expediente o tempo todo.
 *
 * → { allowed, reason?, local }
 */
function isWithinWindow(rules, date = new Date()) {
  const local = localParts(rules, date);
  const weekdays = Array.isArray(rules?.window_weekdays)
    ? rules.window_weekdays.map(Number)
    : CODE_DEFAULTS.window_weekdays;

  if (weekdays.length && !weekdays.includes(local.weekday)) {
    return { allowed: false, reason: 'weekday', local };
  }

  const start = parseHHMM(rules?.window_start, 8 * 60);
  const end = parseHHMM(rules?.window_end, 18 * 60);
  const nowMin = local.hour * 60 + local.minute;

  // Janela que cruza a meia-noite (ex: 22:00→06:00) é união, não
  // intervalo: sem este caso, start > end bloquearia o dia inteiro.
  const inside = start <= end
    ? nowMin >= start && nowMin < end
    : nowMin >= start || nowMin < end;

  return inside ? { allowed: true, local } : { allowed: false, reason: 'outside_hours', local };
}

/** Espera aleatória entre disparos, em ms. `rand` injetável pra teste. */
function nextJitterMs(rules, rand = Math.random) {
  const min = Number(rules?.jitter_min_s ?? CODE_DEFAULTS.jitter_min_s);
  const max = Number(rules?.jitter_max_s ?? CODE_DEFAULTS.jitter_max_s);
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(0, Math.max(min, max));
  return Math.round((lo + rand() * (hi - lo)) * 1000);
}

/**
 * Dorme `ms`, mas acordando a cada KILL_CHECK_SLICE_MS para perguntar se
 * o kill switch ligou. É isto que faz o "para tudo em menos de 30s" ser
 * verdade mesmo com jitter de 120s entre mensagens — um setTimeout único
 * deixaria o motor surdo por dois minutos.
 *
 * → true se dormiu tudo, false se foi interrompido.
 */
async function sleepUnlessKilled(ms, { isKilled, sliceMs = KILL_CHECK_SLICE_MS } = {}) {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    if (isKilled && (await isKilled())) return false;
    const slice = Math.min(sliceMs, remaining);
    await new Promise((r) => setTimeout(r, slice));
    remaining -= slice;
  }
  return !(isKilled && (await isKilled()));
}

module.exports = {
  getRules,
  invalidateRulesCache,
  loadYamlRules,
  effectiveDailyLimit,
  isKillSwitchOn,
  isWithinWindow,
  nextJitterMs,
  sleepUnlessKilled,
  localParts,
  HARD_DAILY_CEILING,
  RULES_CACHE_TTL_MS,
  KILL_CHECK_SLICE_MS,
  CODE_DEFAULTS,
  rulesYamlPath,
};
