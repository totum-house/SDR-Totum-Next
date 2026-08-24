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
