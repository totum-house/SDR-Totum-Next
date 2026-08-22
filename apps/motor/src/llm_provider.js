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
      throw new Error(`${c.name} ${res.status} ${t.slice(0, 140)}`);
    }
    const j = await res.json();
    return String(j.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
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
    const t0 = Date.now();
    try {
      const out = c.kind === 'gemini' ? await genGemini(prompt, c) : await genOpenAICompatible(prompt, c);
      if (out) {
        console.log(`[llm] ${name}/${c.model} ${Date.now() - t0}ms`);
        return out;
      }
      lastErr = new Error(`${name}: resposta vazia`);
    } catch (e) {
      lastErr = e;
      console.warn(`[llm] ${name} falhou (${e.message}) ${Date.now() - t0}ms; tentando próximo`);
    }
  }
  throw lastErr || new Error('nenhum provider respondeu');
}

module.exports = { generate, providerCfg, chainList };
