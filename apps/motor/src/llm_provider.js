/**
 * llm_provider.js — chain de fallback: gemini → groq → nvidia
 *
 * Envs (todas opcionais; provider sem chave é pulado):
 *   GEMINI_API_KEY          GEMINI_MODEL=gemini-2.0-flash
 *   GROQ_API_KEY            GROQ_MODEL=llama-3.3-70b-versatile
 *   NVIDIA_API_KEY          NVIDIA_MODEL=meta/llama-4-maverick-17b-128e-instruct
 *   LLM_CHAIN=gemini,groq,nvidia  (default)
 *   LLM_TIMEOUT_MS=8000
 *
 * Uso:
 *   const { generate } = require('./llm_provider');
 *   const text = await generate('prompt aqui');
 *
 * Sempre 127.0.0.1 no baseUrl interno. Providers externos usam DNS público
 * (api.groq.com, integrate.api.nvidia.com) — não aplicável a regra 127.0.0.1.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_CHAIN = ['gemini', 'groq', 'nvidia'];
const DEFAULT_TIMEOUT = 8000;
// 1 tentativa + 2 retries por provider antes de cair pro próximo da chain
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 250;
// Circuit breaker: após N falhas consecutivas, provider fica de castigo
const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 60_000;

/**
 * Estado do circuit breaker por provider, em memória do processo.
 *
 * Motor roda em instância única (PM2 fork, ver ecosystem.config.cjs), então
 * estado em memória basta. Se um dia virar cluster, isso precisa migrar pra
 * store compartilhada — senão cada worker mantém seu próprio contador.
 *
 *   name → { failures: number, disabledUntil: epoch_ms }
 */
const breakerState = new Map();

function breakerFor(name) {
  if (!breakerState.has(name)) {
    breakerState.set(name, { failures: 0, disabledUntil: 0 });
  }
  return breakerState.get(name);
}

function isProviderDisabled(name, now = Date.now()) {
  return breakerFor(name).disabledUntil > now;
}

function recordSuccess(name) {
  const s = breakerFor(name);
  s.failures = 0;
  s.disabledUntil = 0;
}

function recordFailure(name, now = Date.now()) {
  const s = breakerFor(name);
  const threshold = Math.max(1, Number(process.env.LLM_BREAKER_THRESHOLD || DEFAULT_BREAKER_THRESHOLD));
  const cooldown = Number(process.env.LLM_BREAKER_COOLDOWN_MS || DEFAULT_BREAKER_COOLDOWN_MS);
  s.failures += 1;
  if (s.failures >= threshold) {
    s.disabledUntil = now + cooldown;
    console.warn(`[llm] circuit breaker ABERTO para ${name} por ${cooldown}ms (${s.failures} falhas)`);
  }
}

/** Exposto para testes e para um eventual endpoint de operação. */
function resetBreakers() {
  breakerState.clear();
}

function breakerSnapshot() {
  return Object.fromEntries(
    [...breakerState.entries()].map(([k, v]) => [k, { ...v }])
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function providerCfg(name) {
  switch (name) {
    case 'gemini':
      return {
        kind: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      };
    case 'groq':
      return {
        kind: 'openai',
        apiKey: process.env.GROQ_API_KEY || '',
        baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      };
    case 'nvidia':
      return {
        kind: 'openai',
        apiKey: process.env.NVIDIA_API_KEY || '',
        baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        model: process.env.NVIDIA_MODEL || 'meta/llama-4-maverick-17b-128e-instruct',
      };
    default:
      throw new Error(`llm_provider: provider desconhecido "${name}"`);
  }
}

function chainList() {
  const raw = process.env.LLM_CHAIN;
  if (!raw) return DEFAULT_CHAIN.slice();
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function genGemini(prompt, c) {
  const g = new GoogleGenerativeAI(c.apiKey);
  const res = await g.getGenerativeModel({ model: c.model }).generateContent(prompt);
  return String(res.response.text() || '').trim();
}

async function genOpenAICompatible(prompt, c) {
  const url = c.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const timeout = Number(process.env.LLM_TIMEOUT_MS || DEFAULT_TIMEOUT);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 700,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const err = new Error(`${c.name} ${res.status} ${t.slice(0, 140)}`);
      // status estruturado para o retry decidir se vale re-tentar
      err.status = res.status;
      throw err;
    }
    const j = await res.json();
    return String(j.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Erro que não melhora se tentar de novo: chave inválida, request malformado,
 * modelo inexistente. Re-tentar 401 só gasta latência antes do fallback.
 * 429 e 5xx SÃO transientes — esses valem retry.
 */
function isRetryable(err) {
  const status = err && err.status;
  if (!status) return true; // timeout/abort/rede: vale re-tentar
  if (status === 429) return true;
  return status >= 500;
}

async function callProvider(prompt, c) {
  return c.kind === 'gemini' ? genGemini(prompt, c) : genOpenAICompatible(prompt, c);
}

/**
 * Tenta um provider até LLM_MAX_ATTEMPTS vezes, com backoff exponencial
 * (LLM_RETRY_BASE_MS × 2^n) entre as tentativas. Só re-tenta erro transiente.
 */
async function attemptProvider(prompt, c) {
  const maxAttempts = Math.max(1, Number(process.env.LLM_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS));
  const baseMs = Number(process.env.LLM_RETRY_BASE_MS || DEFAULT_RETRY_BASE_MS);
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    try {
      const out = await callProvider(prompt, c);
      if (out) {
        console.log(`[llm] ${c.name}/${c.model} ${Date.now() - t0}ms (tentativa ${attempt})`);
        return out;
      }
      lastErr = new Error(`${c.name}: resposta vazia`);
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) {
        console.warn(`[llm] ${c.name} erro não-retryable (${e.message}); indo pro próximo provider`);
        throw e;
      }
    }

    if (attempt < maxAttempts) {
      const wait = baseMs * 2 ** (attempt - 1);
      console.warn(
        `[llm] ${c.name} falhou (${lastErr.message}); retry ${attempt}/${maxAttempts - 1} em ${wait}ms`
      );
      await sleep(wait);
    }
  }

  throw lastErr;
}

async function generate(prompt) {
  const chain = chainList();
  let lastErr = null;

  for (const name of chain) {
    const c = providerCfg(name);
    c.name = name;
    if (!c.apiKey) {
      lastErr = new Error(`${name}: sem chave (envs)`);
      continue;
    }
    if (isProviderDisabled(name)) {
      lastErr = new Error(`${name}: circuit breaker aberto`);
      console.warn(`[llm] ${name} pulado — circuit breaker aberto`);
      continue;
    }
    try {
      const out = await attemptProvider(prompt, c);
      recordSuccess(name);
      return out;
    } catch (e) {
      lastErr = e;
      recordFailure(name);
      console.warn(`[llm] ${name} esgotado (${e.message}); tentando próximo provider`);
    }
  }

  throw lastErr || new Error('nenhum provider respondeu');
}

module.exports = {
  generate,
  providerCfg,
  chainList,
  isRetryable,
  resetBreakers,
  breakerSnapshot,
  isProviderDisabled,
};
