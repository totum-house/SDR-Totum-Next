/**
 * rules.test.js — a camada que decide QUANTO pode sair e QUANDO.
 *
 * O foco dos testes é uma propriedade só, repetida de vários ângulos:
 * nenhuma configuração editável (YAML, banco) consegue AFROUXAR a trava.
 * Ela só aperta. Foi assim que 10 mensagens saíram com o limite em 2 em
 * 2026-08-24 — o teto morava num lugar que dava para mudar por fora.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRules,
  invalidateRulesCache,
  effectiveDailyLimit,
  isKillSwitchOn,
  isWithinWindow,
  nextJitterMs,
  sleepUnlessKilled,
  HARD_DAILY_CEILING,
  CODE_DEFAULTS,
} from '../src/rules.js';

let tmpDir;
const envBackup = {};

function writeYaml(content) {
  const file = join(tmpDir, 'rules.yaml');
  writeFileSync(file, content, 'utf8');
  process.env.RULES_YAML_PATH = file;
}

/** Supabase falso: devolve as linhas da tabela `rules` e nada mais. */
function makeDb(rows = [], { fail = false } = {}) {
  return {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve, reject) =>
          Promise.resolve(
            fail ? { data: null, error: new Error('banco fora do ar') } : { data: rows, error: null }
          ).then(resolve, reject),
      };
      return chain;
    },
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sdr-rules-'));
  envBackup.limit = process.env.WARMUP_DAILY_LIMIT;
  envBackup.enabled = process.env.WARMUP_ENABLED;
  envBackup.yaml = process.env.RULES_YAML_PATH;
  delete process.env.WARMUP_DAILY_LIMIT;
  delete process.env.WARMUP_ENABLED;
  invalidateRulesCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const [key, envName] of [
    ['limit', 'WARMUP_DAILY_LIMIT'],
    ['enabled', 'WARMUP_ENABLED'],
    ['yaml', 'RULES_YAML_PATH'],
  ]) {
    if (envBackup[key] === undefined) delete process.env[envName];
    else process.env[envName] = envBackup[key];
  }
  invalidateRulesCache();
});

describe('getRules — precedência da quota', () => {
  it('banco NÃO consegue aumentar o teto acima do env', async () => {
    process.env.WARMUP_DAILY_LIMIT = '2';
    writeYaml('quota_daily: 2\n');
    const db = makeDb([{ key: 'quota_daily', value_json: 500 }]);

    const rules = await getRules({ supabase: db, workspaceId: 'ws-1' });

    expect(rules.quota_daily).toBe(2);
  });

  it('banco consegue ABAIXAR o teto', async () => {
    process.env.WARMUP_DAILY_LIMIT = '50';
    writeYaml('quota_daily: 40\n');
    const db = makeDb([{ key: 'quota_daily', value_json: 5 }]);

    const rules = await getRules({ supabase: db, workspaceId: 'ws-1' });

    expect(rules.quota_daily).toBe(5);
  });

  it('nada passa do hard cap do código, nem env', async () => {
    process.env.WARMUP_DAILY_LIMIT = String(HARD_DAILY_CEILING * 10);
    writeYaml(`quota_daily: ${HARD_DAILY_CEILING * 10}\n`);
    const db = makeDb([{ key: 'quota_daily', value_json: HARD_DAILY_CEILING * 10 }]);

    const rules = await getRules({ supabase: db, workspaceId: 'ws-1' });

    expect(rules.quota_daily).toBe(HARD_DAILY_CEILING);
  });

  it('sem YAML nenhum, cai nos defaults conservadores do código', async () => {
    process.env.RULES_YAML_PATH = join(tmpDir, 'nao-existe.yaml');
    const warn = vi.fn();

    const rules = await getRules({ supabase: null, workspaceId: 'ws-1', logger: { warn } });

    expect(rules.quota_daily).toBe(CODE_DEFAULTS.quota_daily);
    expect(warn).toHaveBeenCalled();
  });

  it('chave desconhecida no banco é ignorada, não vira comportamento', async () => {
    writeYaml('quota_daily: 2\n');
    const db = makeDb([{ key: 'quota_daily_LOL', value_json: 999 }]);

    const rules = await getRules({ supabase: db, workspaceId: 'ws-1' });

    expect(rules.quota_daily).toBe(2);
    expect(rules.quota_daily_LOL).toBeUndefined();
  });

  it('banco fora do ar não derruba nem afrouxa: segue com YAML/env', async () => {
    writeYaml('quota_daily: 3\n');
    const warn = vi.fn();

    const rules = await getRules({
      supabase: makeDb([], { fail: true }),
      workspaceId: 'ws-1',
      logger: { warn },
    });

    expect(rules.quota_daily).toBe(3);
    expect(warn).toHaveBeenCalled();
  });
});

describe('getRules — kill switch', () => {
  it('env liga mesmo com YAML e banco dizendo false', async () => {
    process.env.WARMUP_ENABLED = 'false';
    writeYaml('kill_switch: false\n');
    const db = makeDb([{ key: 'kill_switch', value_json: false }]);

    expect(isKillSwitchOn(await getRules({ supabase: db, workspaceId: 'ws-1' }))).toBe(true);
  });

  it('banco liga mesmo com env permitindo', async () => {
    process.env.WARMUP_ENABLED = 'true';
    writeYaml('kill_switch: false\n');
    const db = makeDb([{ key: 'kill_switch', value_json: true }]);

    expect(isKillSwitchOn(await getRules({ supabase: db, workspaceId: 'ws-1' }))).toBe(true);
  });
});

describe('effectiveDailyLimit — cota da campanha', () => {
  const rules = { quota_daily: 10 };

  it('campanha só abaixa', () => {
    expect(effectiveDailyLimit({ rules, campaign: { quota_daily: 3 } })).toBe(3);
  });

  it('campanha pedindo mais que a global não ganha nada', () => {
    expect(effectiveDailyLimit({ rules, campaign: { quota_daily: 999 } })).toBe(10);
  });

  it('campanha sem cota própria herda a global', () => {
    expect(effectiveDailyLimit({ rules, campaign: { quota_daily: null } })).toBe(10);
    expect(effectiveDailyLimit({ rules })).toBe(10);
  });
});

describe('isWithinWindow', () => {
  const rules = {
    window_start: '08:00',
    window_end: '18:00',
    window_weekdays: [1, 2, 3, 4, 5],
    timezone: 'America/Sao_Paulo',
  };

  // 2026-08-25 é uma terça-feira. 15:00 UTC = 12:00 em São Paulo (UTC-3).
  it('terça 12:00 em São Paulo está dentro', () => {
    expect(isWithinWindow(rules, new Date('2026-08-25T15:00:00Z')).allowed).toBe(true);
  });

  it('terça 05:00 em São Paulo está fora por horário', () => {
    const out = isWithinWindow(rules, new Date('2026-08-25T08:00:00Z'));
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('outside_hours');
  });

  it('sábado no meio do expediente está fora por dia da semana', () => {
    const out = isWithinWindow(rules, new Date('2026-08-29T15:00:00Z'));
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('weekday');
  });

  it('usa o fuso do config, não o da máquina', () => {
    // 23:00 em São Paulo = 09:00 do dia seguinte em Tóquio.
    const instant = new Date('2026-08-26T02:00:00Z');
    expect(isWithinWindow(rules, instant).allowed).toBe(false);
    expect(isWithinWindow({ ...rules, timezone: 'Asia/Tokyo' }, instant).allowed).toBe(true);
  });

  it('janela que cruza a meia-noite é união, não intervalo vazio', () => {
    const noturna = { ...rules, window_start: '22:00', window_end: '06:00', window_weekdays: [] };
    // 03:00 em São Paulo
    expect(isWithinWindow(noturna, new Date('2026-08-25T06:00:00Z')).allowed).toBe(true);
    // 12:00 em São Paulo
    expect(isWithinWindow(noturna, new Date('2026-08-25T15:00:00Z')).allowed).toBe(false);
  });

  it('timezone inválida não explode — cai pro fuso da máquina', () => {
    expect(() => isWithinWindow({ ...rules, timezone: 'Marte/Olympus' }, new Date())).not.toThrow();
  });
});

describe('nextJitterMs', () => {
  it('respeita o intervalo configurado', () => {
    const r = { jitter_min_s: 30, jitter_max_s: 120 };
    expect(nextJitterMs(r, () => 0)).toBe(30_000);
    expect(nextJitterMs(r, () => 1)).toBe(120_000);
    expect(nextJitterMs(r, () => 0.5)).toBe(75_000);
  });

  it('min > max não vira intervalo negativo', () => {
    const r = { jitter_min_s: 120, jitter_max_s: 30 };
    expect(nextJitterMs(r, () => 0)).toBe(30_000);
    expect(nextJitterMs(r, () => 1)).toBe(120_000);
  });
});

describe('sleepUnlessKilled — o que faz o kill switch valer em <30s', () => {
  it('interrompe uma espera longa em vez de dormir até o fim', async () => {
    vi.useFakeTimers();
    let killed = false;
    const promise = sleepUnlessKilled(120_000, {
      isKilled: async () => killed,
      sliceMs: 2_000,
    });

    await vi.advanceTimersByTimeAsync(4_000);
    killed = true;
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(promise).resolves.toBe(false);
    vi.useRealTimers();
  });

  it('dorme o tempo todo quando ninguém interrompe', async () => {
    vi.useFakeTimers();
    const promise = sleepUnlessKilled(6_000, { isKilled: async () => false, sliceMs: 2_000 });
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(promise).resolves.toBe(true);
    vi.useRealTimers();
  });
});
