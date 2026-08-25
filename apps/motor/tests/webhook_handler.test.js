/**
 * webhook_handler.test.js — cobre o pipeline webhook → lead/conversation →
 * flow_runner → persistência → envio via OpenWA, com supabase e openwa mockados.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleInboundEvent, dispatchToLead, parseInboundEvent } from '../src/webhook_handler.js';

function makeSupabase(responses) {
  function chainFor(table) {
    let op = null;
    let isCount = false;
    const r = () => responses[table] || {};
    const chain = {
      select(_cols, opts) {
        if (opts && opts.count) isCount = true;
        if (op !== 'insert' && op !== 'update') op = 'select';
        return chain;
      },
      insert(payload) { op = 'insert'; chain.__payload = payload; return chain; },
      update(payload) { op = 'update'; chain.__payload = payload; return chain; },
      eq() { return chain; },
      in() { return chain; },
      gte() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle: async () => r()[op] || { data: null, error: null },
      single: async () => r()[op] || { data: null, error: null },
      // await direto na chain (sem maybeSingle/single):
      // é query de contagem ou de lista
      then(resolve, reject) {
        const out = isCount
          ? r().count || { count: 0, error: null }
          : r().list || { data: [], error: null };
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return chain;
  }
  return { from: (table) => chainFor(table) };
}

// Cota de warm-up folgada por padrão nos testes que não são sobre ela.
function withQuota(responses, { conversationIds = ['conv-1'], sentToday = 0 } = {}) {
  return {
    ...responses,
    conversations: {
      ...(responses.conversations || {}),
      list: { data: conversationIds.map((id) => ({ id })), error: null },
    },
    messages: {
      ...(responses.messages || {}),
      count: { count: sentToday, error: null },
    },
  };
}

const inboundBody = { from: '5511999999999@c.us', body: 'oi' };

// Formato real, confirmado em 2026-08-24 contra POST /webhooks/{id}/test:
// { event, timestamp, sessionId, idempotencyKey, deliveryId, data: {...} }
const realEnvelope = {
  event: 'message.received',
  timestamp: '2026-08-24T20:00:00Z',
  sessionId: '11e1b06b-7ca7-4095-8acc-75eb198a3dc6',
  idempotencyKey: 'evt_abc123',
  deliveryId: 'dlv_xyz789',
  data: {
    id: 'internal-uuid-1',
    waMessageId: 'true_5511999999999@c.us_3EB0ABCDEF',
    chatId: '5511999999999@c.us',
    from: '5511999999999@c.us',
    to: '5511888888888@c.us',
    body: 'oi',
    type: 'text',
    direction: 'incoming',
  },
};

describe('parseInboundEvent', () => {
  it('extrai phone/text/waMessageId do envelope real (data.*)', () => {
    expect(parseInboundEvent(realEnvelope)).toEqual({
      phone_e164: '5511999999999',
      text: 'oi',
      openwa_message_id: 'true_5511999999999@c.us_3EB0ABCDEF',
    });
  });

  it('cai pro id interno do OpenWA quando waMessageId ainda não foi atribuído', () => {
    const envelope = { data: { ...realEnvelope.data, waMessageId: undefined } };
    expect(parseInboundEvent(envelope).openwa_message_id).toBe('internal-uuid-1');
  });

  it('aceita payload sem envelope, como rede de segurança', () => {
    expect(parseInboundEvent(inboundBody)).toEqual({
      phone_e164: '5511999999999',
      text: 'oi',
      openwa_message_id: null,
    });
  });

  it('retorna null sem remetente reconhecível, com ou sem envelope', () => {
    expect(parseInboundEvent({ body: 'oi' })).toBe(null);
    expect(parseInboundEvent({ data: { body: 'oi' } })).toBe(null);
  });
});

describe('handleInboundEvent', () => {
  it('sem flow ativo: só persiste a mensagem e não chama OpenWA', async () => {
    const supabase = makeSupabase(withQuota({
      leads: { select: { data: { id: 'lead-1' }, error: null } },
      conversations: {
        select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
      },
      messages: { insert: { data: null, error: null } },
      flows: { select: { data: null, error: null } },
    }));
    const openwa = { sendMessage: vi.fn() };

    const result = await handleInboundEvent({
      body: inboundBody,
      workspaceId: 'ws-1',
      supabase,
      openwa,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(result).toEqual({ ok: true, persisted: true, flow: null });
    expect(openwa.sendMessage).not.toHaveBeenCalled();
  });

  it('com flow ativo: roda o step, persiste updates e envia outbound via OpenWA', async () => {
    const flow = {
      id: 'flow-1',
      graph: {
        entry_step_id: 'msg1',
        nodes: [{ id: 'msg1', type: 'message', text: 'Fixed reply' }],
        edges: [],
      },
    };
    const supabase = makeSupabase(withQuota({
      leads: { select: { data: { id: 'lead-1' }, error: null } },
      conversations: {
        select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
        update: { data: null, error: null },
      },
      messages: { insert: { data: null, error: null } },
      flows: { select: { data: flow, error: null } },
    }));
    const openwa = { sendMessage: vi.fn().mockResolvedValue({ ok: true }) };

    const result = await handleInboundEvent({
      body: inboundBody,
      workspaceId: 'ws-1',
      supabase,
      openwa,
    });

    expect(result.ok).toBe(true);
    expect(result.outbound).toBe(1);
    expect(result.done).toBe(false);
    expect(openwa.sendMessage).toHaveBeenCalledWith('5511999999999', 'Fixed reply');
  });

  it('cria lead e conversation quando não existem ainda', async () => {
    const flow = null;
    const supabase = makeSupabase(withQuota({
      leads: {
        select: { data: null, error: null },
        insert: { data: { id: 'new-lead' }, error: null },
      },
      conversations: {
        select: { data: null, error: null },
        insert: { data: { id: 'new-conv', context: {}, status: 'open', current_step_id: null }, error: null },
      },
      messages: { insert: { data: null, error: null } },
      flows: { select: { data: flow, error: null } },
    }));
    const openwa = { sendMessage: vi.fn() };

    const result = await handleInboundEvent({
      body: inboundBody,
      workspaceId: 'ws-1',
      supabase,
      openwa,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(result.persisted).toBe(true);
  });
});

describe('dispatchToLead', () => {
  const flow = {
    id: 'flow-1',
    graph: {
      entry_step_id: 'msg1',
      nodes: [{ id: 'msg1', type: 'message', text: 'Primeira abordagem' }],
      edges: [],
    },
  };

  it('lead inexistente: retorna lead_not_found sem chamar OpenWA', async () => {
    const supabase = makeSupabase(withQuota({ leads: { select: { data: null, error: null } } }));
    const openwa = { sendMessage: vi.fn() };

    const result = await dispatchToLead({
      leadId: 'nope',
      workspaceId: 'ws-1',
      supabase,
      openwa,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(result).toEqual({ ok: false, error: 'lead_not_found' });
    expect(openwa.sendMessage).not.toHaveBeenCalled();
  });

  it('sem flow ativo: retorna no_active_flow', async () => {
    const supabase = makeSupabase(withQuota({
      leads: { select: { data: { id: 'lead-1', phone_e164: '5511999999999' }, error: null } },
      conversations: {
        select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
      },
      flows: { select: { data: null, error: null } },
    }));
    const openwa = { sendMessage: vi.fn() };

    const result = await dispatchToLead({
      leadId: 'lead-1',
      workspaceId: 'ws-1',
      supabase,
      openwa,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(result).toEqual({ ok: false, error: 'no_active_flow' });
    expect(openwa.sendMessage).not.toHaveBeenCalled();
  });

  it('caminho feliz: roda o step sem inbound e envia outbound pro telefone do lead', async () => {
    const supabase = makeSupabase(withQuota({
      leads: { select: { data: { id: 'lead-1', phone_e164: '5511999999999' }, error: null } },
      conversations: {
        select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
        update: { data: null, error: null },
      },
      messages: { insert: { data: null, error: null } },
      flows: { select: { data: flow, error: null } },
    }));
    const openwa = { sendMessage: vi.fn().mockResolvedValue({ ok: true }) };

    const result = await dispatchToLead({
      leadId: 'lead-1',
      workspaceId: 'ws-1',
      supabase,
      openwa,
    });

    expect(result.ok).toBe(true);
    expect(result.outbound).toBe(1);
    expect(openwa.sendMessage).toHaveBeenCalledWith('5511999999999', 'Primeira abordagem');
  });
});

describe('trava de warm-up', () => {
  const flow = {
    id: 'flow-1',
    graph: {
      entry_step_id: 'msg1',
      nodes: [{ id: 'msg1', type: 'message', text: 'Oi!' }],
      edges: [],
    },
  };

  function scenario({ sentToday, env = {} }) {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    const supabase = makeSupabase(
      withQuota(
        {
          leads: { select: { data: { id: 'lead-1', phone_e164: '5511999999999' }, error: null } },
          conversations: {
            select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
            update: { data: null, error: null },
          },
          messages: { insert: { data: null, error: null } },
          flows: { select: { data: flow, error: null } },
        },
        { sentToday }
      )
    );
    const openwa = { sendMessage: vi.fn().mockResolvedValue({ ok: true }) };
    const restore = () => { process.env = prev; };
    return { supabase, openwa, restore };
  }

  it('dentro da cota: envia normalmente', async () => {
    const { supabase, openwa, restore } = scenario({ sentToday: 0, env: { WARMUP_DAILY_LIMIT: '2' } });
    const result = await dispatchToLead({ leadId: 'lead-1', workspaceId: 'ws-1', supabase, openwa });
    restore();
    expect(result.outbound).toBe(1);
    expect(result.warmup_blocked).toBeUndefined();
    expect(openwa.sendMessage).toHaveBeenCalled();
  });

  it('cota do dia estourada: NÃO envia e sinaliza daily_limit', async () => {
    const { supabase, openwa, restore } = scenario({ sentToday: 2, env: { WARMUP_DAILY_LIMIT: '2' } });
    const result = await dispatchToLead({
      leadId: 'lead-1', workspaceId: 'ws-1', supabase, openwa,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    restore();
    expect(result.outbound).toBe(0);
    expect(result.warmup_blocked).toBe('daily_limit');
    expect(openwa.sendMessage).not.toHaveBeenCalled();
  });

  it('kill switch WARMUP_ENABLED=false bloqueia mesmo com cota livre', async () => {
    const { supabase, openwa, restore } = scenario({
      sentToday: 0,
      env: { WARMUP_DAILY_LIMIT: '100', WARMUP_ENABLED: 'false' },
    });
    const result = await dispatchToLead({
      leadId: 'lead-1', workspaceId: 'ws-1', supabase, openwa,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    restore();
    expect(result.outbound).toBe(0);
    expect(result.warmup_blocked).toBe('kill_switch');
    expect(openwa.sendMessage).not.toHaveBeenCalled();
  });

  it('default conservador: sem env configurada o limite é 2', async () => {
    const { supabase, openwa, restore } = scenario({ sentToday: 2, env: {} });
    delete process.env.WARMUP_DAILY_LIMIT;
    delete process.env.WARMUP_ENABLED;
    const result = await dispatchToLead({
      leadId: 'lead-1', workspaceId: 'ws-1', supabase, openwa,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    restore();
    expect(result.warmup_blocked).toBe('daily_limit');
  });
});

describe('falha no envio via OpenWA', () => {
  const flow = {
    id: 'flow-1',
    graph: {
      entry_step_id: 'msg1',
      nodes: [{ id: 'msg1', type: 'message', text: 'Oi!' }],
      edges: [],
    },
  };

  it('sessão não conectada: não persiste a mensagem, não propaga erro (evita retry-storm do OpenWA)', async () => {
    const supabase = makeSupabase(
      withQuota({
        leads: { select: { data: { id: 'lead-1', phone_e164: '5511999999999' }, error: null } },
        conversations: {
          select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
          update: { data: null, error: null },
        },
        flows: { select: { data: flow, error: null } },
      })
    );
    const insertMessages = vi.fn();
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = (table) => {
      const chain = originalFrom(table);
      if (table === 'messages') {
        const originalInsert = chain.insert.bind(chain);
        chain.insert = (payload) => {
          insertMessages(payload);
          return originalInsert(payload);
        };
      }
      return chain;
    };
    const openwa = { sendMessage: vi.fn().mockRejectedValue(new Error('session not connected')) };

    const result = await dispatchToLead({
      leadId: 'lead-1',
      workspaceId: 'ws-1',
      supabase,
      openwa,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    // não lança — handleInboundEvent/dispatchToLead resolvem normalmente
    expect(result.ok).toBe(true);
    expect(result.outbound).toBe(0);
    expect(result.send_error).toMatch(/session not connected/);
    // mensagem outbound NÃO foi gravada — não persiste o que não foi enviado
    expect(insertMessages).not.toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'outbound' })
    );
  });
});

describe('race condition na cota de warm-up (incidente 2026-08-24)', () => {
  /**
   * Mock com ESTADO real: messages.count reflete quantos outbound já
   * foram inseridos de fato, dinamicamente — ao contrário de makeSupabase
   * (respostas estáticas), que não serve pra provar isto. É o único jeito
   * de reproduzir o incidente: 13 webhooks quase simultâneos, cota=2,
   * SEM lock cada um lia o count ANTES de qualquer insert e todos viam
   * "tem vaga".
   */
  function makeStatefulSupabase({ leadsByPhone, flow }) {
    let outboundCount = 0;
    const conversations = new Map(); // phone -> conversation

    function chainFor(table) {
      let op = null;
      let payload = null;
      let filters = {};
      const chain = {
        select(_cols, opts) {
          if (op !== 'insert' && op !== 'update') op = opts?.count ? 'count' : 'select';
          return chain;
        },
        insert(p) { op = 'insert'; payload = p; return chain; },
        update(p) { op = 'update'; payload = p; return chain; },
        eq(col, val) { filters[col] = val; return chain; },
        in() { return chain; },
        gte() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle: async () => resolve(),
        single: async () => resolve(),
        then(resolve_, reject) { return Promise.resolve(resolve()).then(resolve_, reject); },
      };
      function resolve() {
        if (table === 'leads' && op === 'select') {
          const phone = filters.phone_e164;
          const id = filters.id;
          const lead = phone ? leadsByPhone[phone] : Object.values(leadsByPhone).find((l) => l.id === id);
          return { data: lead || null, error: null };
        }
        if (table === 'conversations' && op === 'select') {
          if (filters.id) {
            for (const c of conversations.values()) if (c.id === filters.id) return { data: c, error: null };
            return { data: null, error: null };
          }
          if (filters.lead_id) {
            const found = [...conversations.values()].find((c) => c.lead_id === filters.lead_id);
            return { data: found || null, error: null };
          }
          // sem lead_id: é a query de countOutboundToday (lista todas as
          // conversations do workspace) — formato diferente da busca
          // de conversation única (findOrCreateConversation).
          return { data: [...conversations.values()].map((c) => ({ id: c.id })), error: null };
        }
        if (table === 'conversations' && op === 'insert') {
          const conv = { id: `conv-${payload.lead_id}`, lead_id: payload.lead_id, context: {}, status: 'open', current_step_id: null };
          conversations.set(conv.id, conv);
          return { data: conv, error: null };
        }
        if (table === 'conversations' && op === 'update') {
          return { data: null, error: null };
        }
        if (table === 'flows' && op === 'select') {
          return { data: flow, error: null };
        }
        if (table === 'messages' && op === 'insert') {
          if (payload.direction === 'outbound') outboundCount += 1;
          return { data: null, error: null };
        }
        if (table === 'messages' && op === 'count') {
          return { count: outboundCount, error: null };
        }
        return { data: null, error: null };
      }
      return chain;
    }
    return { from: (t) => chainFor(t), getOutboundCount: () => outboundCount };
  }

  it('sob 8 dispatches concorrentes, no máximo WARMUP_DAILY_LIMIT saem — não passa disso', async () => {
    const prevLimit = process.env.WARMUP_DAILY_LIMIT;
    const prevEnabled = process.env.WARMUP_ENABLED;
    process.env.WARMUP_DAILY_LIMIT = '2';
    process.env.WARMUP_ENABLED = 'true';

    const flow = {
      id: 'flow-1',
      graph: {
        entry_step_id: 'msg1',
        nodes: [{ id: 'msg1', type: 'message', text: 'Oi!' }],
        edges: [],
      },
    };
    const leadsByPhone = {};
    for (let i = 0; i < 8; i++) {
      leadsByPhone[`lead-${i}`] = { id: `lead-${i}`, phone_e164: `551199999000${i}` };
    }
    const supabase = makeStatefulSupabase({ leadsByPhone, flow });
    const openwa = { sendMessage: vi.fn().mockResolvedValue({ ok: true }) };

    // 8 chamadas disparadas ao mesmo tempo (Promise.all), simulando a
    // rajada de webhooks quase simultâneos do incidente real.
    await Promise.all(
      Object.keys(leadsByPhone).map((leadId) =>
        dispatchToLead({
          leadId,
          workspaceId: 'ws-1',
          supabase,
          openwa,
          logger: { warn: vi.fn(), error: vi.fn() },
        })
      )
    );

    process.env.WARMUP_DAILY_LIMIT = prevLimit;
    process.env.WARMUP_ENABLED = prevEnabled;

    // A prova real: nunca mais que 2 sends de fato aconteceram, mesmo
    // com 8 tentativas concorrentes disputando a mesma cota.
    expect(openwa.sendMessage.mock.calls.length).toBeLessThanOrEqual(2);
    expect(supabase.getOutboundCount()).toBeLessThanOrEqual(2);
  });
});
