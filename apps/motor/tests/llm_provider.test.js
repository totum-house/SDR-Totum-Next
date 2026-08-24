/**
 * llm_provider.test.js — cobre o retry com backoff por provider e o
 * fallback ao longo da chain, com fetch mockado.
 *
 * Usa só providers openai-compatible (groq/nvidia) porque gemini passa
 * pelo SDK @google/generative-ai, que não é interceptável por fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generate,
  isRetryable,
  resetBreakers,
  isProviderDisabled,
} from '../src/llm_provider.js';

const ORIGINAL_ENV = { ...process.env };

function okResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function errResponse(status) {
  return {
    ok: false,
    status,
    text: async () => `erro ${status}`,
  };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.LLM_CHAIN = 'groq,nvidia';
  process.env.GROQ_API_KEY = 'k-groq';
  process.env.NVIDIA_API_KEY = 'k-nvidia';
  process.env.LLM_RETRY_BASE_MS = '1'; // mantém o teste rápido
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  resetBreakers();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('isRetryable', () => {
  it('re-tenta 429 e 5xx', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
  });

  it('não re-tenta 4xx de cliente', () => {
    expect(isRetryable({ status: 401 })).toBe(false);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
  });

  it('re-tenta erro sem status (timeout/rede)', () => {
    expect(isRetryable(new Error('aborted'))).toBe(true);
  });
});

describe('generate — retry por provider', () => {
  it('retorna na primeira tentativa quando o provider responde', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('resposta boa'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).resolves.toBe('resposta boa');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-tenta o MESMO provider em erro transiente antes de trocar', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(okResponse('veio no retry'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).resolves.toBe('veio no retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('esgota 3 tentativas no provider 1 e cai pro provider 2', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(okResponse('do segundo provider'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).resolves.toBe('do segundo provider');
    expect(fetchMock).toHaveBeenCalledTimes(4); // 3 no groq + 1 no nvidia
  });

  it('NÃO re-tenta erro não-retryable — vai direto pro próximo provider', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(401))
      .mockResolvedValueOnce(okResponse('segundo provider'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).resolves.toBe('segundo provider');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 no groq (sem retry) + 1 no nvidia
  });

  it('pula provider sem chave configurada', async () => {
    delete process.env.GROQ_API_KEY;
    const fetchMock = vi.fn().mockResolvedValue(okResponse('nvidia respondeu'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).resolves.toBe('nvidia respondeu');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lança quando a chain inteira falha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(6); // 3 tentativas × 2 providers
  });
});

describe('circuit breaker por provider', () => {
  it('abre depois de 3 falhas consecutivas e passa a pular o provider', async () => {
    process.env.LLM_CHAIN = 'groq';
    const fetchMock = vi.fn().mockResolvedValue(errResponse(500));
    vi.stubGlobal('fetch', fetchMock);

    // 1ª chamada: esgota as 3 tentativas → 1 falha registrada
    await expect(generate('oi')).rejects.toThrow();
    expect(isProviderDisabled('groq')).toBe(false);

    await expect(generate('oi')).rejects.toThrow();
    expect(isProviderDisabled('groq')).toBe(false);

    // 3ª falha consecutiva → breaker abre
    await expect(generate('oi')).rejects.toThrow();
    expect(isProviderDisabled('groq')).toBe(true);

    // 4ª chamada nem toca a rede
    const before = fetchMock.mock.calls.length;
    await expect(generate('oi')).rejects.toThrow(/circuit breaker/);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('sucesso zera o contador de falhas', async () => {
    process.env.LLM_CHAIN = 'groq';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValue(okResponse('voltou'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).rejects.toThrow(); // falha 1
    await expect(generate('oi')).resolves.toBe('voltou'); // sucesso zera

    // duas falhas novas não bastam pra abrir (contador foi zerado)
    fetchMock.mockResolvedValue(errResponse(500));
    await expect(generate('oi')).rejects.toThrow();
    await expect(generate('oi')).rejects.toThrow();
    expect(isProviderDisabled('groq')).toBe(false);
  });

  it('breaker aberto no provider 1 faz a chain usar o provider 2', async () => {
    process.env.LLM_CHAIN = 'groq,nvidia';
    process.env.LLM_BREAKER_THRESHOLD = '1';
    const fetchMock = vi.fn().mockResolvedValue(errResponse(500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).rejects.toThrow();
    expect(isProviderDisabled('groq')).toBe(true);
    expect(isProviderDisabled('nvidia')).toBe(true);

    resetBreakers();
    process.env.LLM_BREAKER_THRESHOLD = '1';
    const fetch2 = vi
      .fn()
      .mockResolvedValueOnce(errResponse(500)) // groq falha, abre
      .mockResolvedValue(okResponse('nvidia ok'));
    vi.stubGlobal('fetch', fetch2);
    await expect(generate('oi')).resolves.toBe('nvidia ok');
  });

  it('cooldown expirado reabilita o provider', async () => {
    process.env.LLM_CHAIN = 'groq';
    process.env.LLM_BREAKER_THRESHOLD = '1';
    process.env.LLM_BREAKER_COOLDOWN_MS = '0'; // expira imediatamente
    process.env.LLM_MAX_ATTEMPTS = '1'; // sem retry: 1 falha já esgota o provider
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValue(okResponse('voltou'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generate('oi')).rejects.toThrow();
    expect(isProviderDisabled('groq')).toBe(false); // cooldown 0 = já liberado
    await expect(generate('oi')).resolves.toBe('voltou');
  });
});
