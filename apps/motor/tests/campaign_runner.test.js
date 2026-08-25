/**
 * campaign_runner.test.js — o ciclo que faz o motor prospectar sozinho.
 *
 * Cada teste é UMA passada (tick), sem timers: o loop em si é só
 * "tick + dormir", e o que importa verificar são as travas antes do
 * disparo e o que acontece com o lead quando o disparo não completa.
 *
 * A propriedade central: um lead só sai da fila se a mensagem REALMENTE
 * saiu. Bloqueio de cota ou erro de gateway devolve o lead — senão a
 * campanha "terminaria" tendo falado com metade da lista.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCampaignRunner } from '../src/campaign_runner.js';
import { __reset as resetEvents, recentEvents } from '../src/events.js';

const WS = 'ws-1';

const envBackup = {};

/**
 * Rules injetadas direto: precedência YAML/env/banco, janela e cache são
 * assunto de rules.test.js. Aqui interessa só o que o ciclo faz DIANTE
 * de um conjunto de regras — sem I/O de arquivo no meio.
 */
const RULES_PERMISSIVAS = {
  kill_switch: false,
  quota_daily: 10,
  window_start: '00:00',
  window_end: '23:59',
  window_weekdays: [1, 2, 3, 4, 5, 6, 7],
  timezone: 'America/Sao_Paulo',
  jitter_min_s: 30,
  jitter_max_s: 120,
};

/**
 * Supabase falso que REGISTRA os updates — é o que os testes inspecionam
 * para saber se o lead voltou para a fila ou foi marcado como falho.
 */
function makeDb(responses = {}) {
  const writes = [];
  function chain(table) {
    const state = { table, op: 'select', isCount: false };
    const table_ = () => responses[table] || {};
    const c = {
      select(_cols, opts) {
        if (opts && opts.count) state.isCount = true;
        if (state.op !== 'insert' && state.op !== 'update') state.op = 'select';
        return c;
      },
      insert(payload) { state.op = 'insert'; writes.push({ table, op: 'insert', payload }); return c; },
      update(payload) { state.op = 'update'; writes.push({ table, op: 'update', payload }); return c; },
      eq() { return c; },
      in() { return c; },
      gte() { return c; },
      order() { return c; },
      limit() { return c; },
      maybeSingle: async () => table_()[state.op] || { data: null, error: null },
      single: async () => table_()[state.op] || { data: null, error: null },
      then(resolve, reject) {
        const out = state.isCount
          ? table_().count || { count: 0, error: null }
          : table_().list || { data: [], error: null };
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return c;
  }
  return { from: (t) => chain(t), __writes: writes };
}

const FLOW = {
  id: 'flow-1',
  graph: {
    entry_step_id: 'msg1',
    nodes: [{ id: 'msg1', type: 'message', text: 'Oi, tudo bem?' }],
    edges: [],
  },
};

const CAMPAIGN = {
  id: 'camp-1',
  name: 'Prospecção agosto',
  flow_id: 'flow-1',
  status: 'running',
  quota_daily: null,
};

/** Cenário feliz: campanha rodando, 1 lead na fila, cota livre. */
function cenario(overrides = {}) {
  return makeDb({
    rules: { list: { data: [], error: null } },
    campaigns: { select: { data: CAMPAIGN, error: null } },
    conversations: {
      list: { data: [{ id: 'conv-1' }], error: null },
      select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
    },
    messages: { count: { count: 0, error: null } },
    campaign_leads: {
      select: { data: { id: 'cl-1', lead_id: 'lead-1', attempts: 0, status: 'queued' }, error: null },
      update: { data: { id: 'cl-1', lead_id: 'lead-1', attempts: 1, status: 'dispatched' }, error: null },
    },
    leads: { select: { data: { id: 'lead-1', phone_e164: '5511999999999' }, error: null } },
    flows: { select: { data: FLOW, error: null } },
    ...overrides,
  });
}

function runner(db, openwa, rules = RULES_PERMISSIVAS) {
  return createCampaignRunner({
    supabase: db,
    openwa,
    workspaceId: WS,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    rulesProvider: async () => rules,
  });
}

function updatesTo(db, table) {
  return db.__writes.filter((w) => w.table === table && w.op === 'update').map((w) => w.payload);
}

beforeEach(() => {
  // O env ainda importa: warmup.checkQuota combina o limite recebido com
  // WARMUP_DAILY_LIMIT pelo menor valor, e é isso que garante que rule
  // nenhuma consegue passar do teto do deploy.
  envBackup.limit = process.env.WARMUP_DAILY_LIMIT;
  envBackup.enabled = process.env.WARMUP_ENABLED;
  process.env.WARMUP_DAILY_LIMIT = '10';
  process.env.WARMUP_ENABLED = 'true';
  resetEvents();
});

afterEach(() => {
  for (const [key, envName] of [
    ['limit', 'WARMUP_DAILY_LIMIT'],
    ['enabled', 'WARMUP_ENABLED'],
  ]) {
    if (envBackup[key] === undefined) delete process.env[envName];
    else process.env[envName] = envBackup[key];
  }
});

describe('tick — travas antes de qualquer envio', () => {
  it('kill switch para tudo e nem chega a olhar a campanha', async () => {
    const db = cenario();
    const openwa = { sendMessage: vi.fn() };

    const out = await runner(db, openwa, { ...RULES_PERMISSIVAS, kill_switch: true }).tick();

    expect(out.status).toBe('killed');
    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(db.__writes).toHaveLength(0);
  });

  it('sem campanha rodando, fica ocioso', async () => {
    const db = cenario({ campaigns: { select: { data: null, error: null } } });
    const openwa = { sendMessage: vi.fn() };

    expect((await runner(db, openwa).tick()).status).toBe('idle');
    expect(openwa.sendMessage).not.toHaveBeenCalled();
  });

  it('fora da janela de atendimento não inicia conversa', async () => {
    const db = cenario();
    const openwa = { sendMessage: vi.fn() };
    // Nenhum dia da semana permitido = sempre fora, independente da hora
    // em que a suíte roda. Testar por horário deixaria o teste dependente
    // do relógio de quem roda.
    const rules = { ...RULES_PERMISSIVAS, window_weekdays: [0] };

    const out = await runner(db, openwa, rules).tick();

    expect(out.status).toBe('outside_window');
    expect(out.reason).toBe('weekday');
    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(db.__writes.filter((w) => w.table === 'campaign_leads')).toHaveLength(0);
  });

  it('cota do dia estourada não dispara nem tira lead da fila', async () => {
    const db = cenario({ messages: { count: { count: 2, error: null } } });
    const openwa = { sendMessage: vi.fn() };

    const out = await runner(db, openwa, { ...RULES_PERMISSIVAS, quota_daily: 2 }).tick();

    expect(out.status).toBe('quota_exhausted');
    expect(out.limit).toBe(2);
    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(updatesTo(db, 'campaign_leads')).toHaveLength(0);
  });
});

describe('tick — disparo', () => {
  it('caminho feliz: envia, marca o lead como disparado e publica no /live', async () => {
    const db = cenario();
    const openwa = { sendMessage: vi.fn().mockResolvedValue({ ok: true }) };

    const out = await runner(db, openwa).tick();

    expect(out.status).toBe('dispatched');
    expect(openwa.sendMessage).toHaveBeenCalledWith('5511999999999', 'Oi, tudo bem?');
    expect(updatesTo(db, 'campaign_leads')[0]).toMatchObject({ status: 'dispatched', attempts: 1 });
    expect(recentEvents().some((e) => e.type === 'outbound_sent')).toBe(true);
  });

  it('a conversation criada fica marcada com a campanha', async () => {
    const db = cenario({
      conversations: {
        list: { data: [{ id: 'conv-1' }], error: null },
        select: { data: null, error: null }, // não existe conversa aberta → cria
        insert: { data: { id: 'conv-nova', context: {}, status: 'open' }, error: null },
      },
    });
    const openwa = { sendMessage: vi.fn().mockResolvedValue({ ok: true }) };

    await runner(db, openwa).tick();

    const insert = db.__writes.find((w) => w.table === 'conversations' && w.op === 'insert');
    expect(insert.payload).toMatchObject({ workspace_id: WS, lead_id: 'lead-1', campaign_id: 'camp-1' });
  });

  it('fila vazia encerra a campanha como done', async () => {
    const db = cenario({ campaign_leads: { select: { data: null, error: null } } });
    const openwa = { sendMessage: vi.fn() };

    const out = await runner(db, openwa).tick();

    expect(out.status).toBe('campaign_done');
    expect(updatesTo(db, 'campaigns')[0]).toMatchObject({ status: 'done' });
    expect(recentEvents().some((e) => e.type === 'campaign_done')).toBe(true);
  });
});

describe('tick — o lead volta para a fila quando a mensagem não sai', () => {
  it('bloqueio de cota no meio do disparo devolve o lead', async () => {
    // Cota livre no tick (0 enviadas), estourada no momento do envio.
    let calls = 0;
    const db = cenario();
    const original = db.from;
    db.from = (table) => {
      if (table === 'messages') {
        calls += 1;
        // 1ª contagem = a do tick; 2ª = a de dentro do runFlowStep.
        const count = calls >= 2 ? 10 : 0;
        const chain = original('messages');
        chain.then = (resolve, reject) =>
          Promise.resolve({ count, error: null }).then(resolve, reject);
        return chain;
      }
      return original(table);
    };
    const openwa = { sendMessage: vi.fn() };

    const out = await runner(db, openwa).tick();

    expect(out.status).toBe('blocked');
    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(updatesTo(db, 'campaign_leads').at(-1)).toMatchObject({ status: 'queued' });
  });

  it('erro de gateway com tentativas de sobra devolve o lead para retry', async () => {
    const db = cenario();
    const openwa = { sendMessage: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };

    const out = await runner(db, openwa).tick();

    expect(out.status).toBe('retry');
    expect(updatesTo(db, 'campaign_leads').at(-1)).toMatchObject({ status: 'queued' });
  });

  it('erro de gateway na última tentativa marca como falho, sem insistir', async () => {
    const db = cenario({
      campaign_leads: {
        select: { data: { id: 'cl-1', lead_id: 'lead-1', attempts: 2, status: 'queued' }, error: null },
        update: { data: { id: 'cl-1', lead_id: 'lead-1', attempts: 3, status: 'dispatched' }, error: null },
      },
    });
    const openwa = { sendMessage: vi.fn().mockRejectedValue(new Error('número inválido')) };

    const out = await runner(db, openwa).tick();

    expect(out.status).toBe('failed');
    expect(updatesTo(db, 'campaign_leads').at(-1)).toMatchObject({ status: 'failed' });
  });

  it('flow apagado debaixo da campanha pausa a campanha em vez de queimar a fila', async () => {
    const db = cenario({ flows: { select: { data: null, error: null } } });
    const openwa = { sendMessage: vi.fn() };

    const out = await runner(db, openwa).tick();

    expect(out.status).toBe('flow_not_found');
    expect(updatesTo(db, 'campaign_leads').at(-1)).toMatchObject({ status: 'queued' });
    expect(updatesTo(db, 'campaigns').at(-1)).toMatchObject({ status: 'paused' });
    expect(openwa.sendMessage).not.toHaveBeenCalled();
  });

  it('lead apagado marca como falho e não trava a fila', async () => {
    const db = cenario({ leads: { select: { data: null, error: null } } });
    const openwa = { sendMessage: vi.fn() };

    const out = await runner(db, openwa).tick();

    expect(out.status).toBe('lead_not_found');
    expect(updatesTo(db, 'campaign_leads').at(-1)).toMatchObject({ status: 'failed' });
  });
});
