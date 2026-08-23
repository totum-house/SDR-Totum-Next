/**
 * webhook_handler.test.js — cobre o pipeline webhook → lead/conversation →
 * flow_runner → persistência → envio via OpenWA, com supabase e openwa mockados.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleInboundEvent, parseInboundEvent } from '../src/webhook_handler.js';

function makeSupabase(responses) {
  function chainFor(table) {
    let op = null;
    const resultFor = () => (responses[table] && responses[table][op]) || { data: null, error: null };
    const chain = {
      select() { if (op !== 'insert' && op !== 'update') op = 'select'; return chain; },
      insert(payload) { op = 'insert'; chain.__payload = payload; return chain; },
      update(payload) { op = 'update'; chain.__payload = payload; return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle: async () => resultFor(),
      single: async () => resultFor(),
      then(resolve, reject) {
        return Promise.resolve(resultFor()).then(resolve, reject);
      },
    };
    return chain;
  }
  return { from: (table) => chainFor(table) };
}

const inboundBody = { from: '5511999999999@c.us', body: 'oi' };

describe('parseInboundEvent', () => {
  it('extrai phone/text de um payload wa-automate-like', () => {
    expect(parseInboundEvent(inboundBody)).toEqual({
      phone_e164: '5511999999999',
      text: 'oi',
      openwa_message_id: null,
    });
  });

  it('retorna null sem remetente reconhecível', () => {
    expect(parseInboundEvent({ body: 'oi' })).toBe(null);
  });
});

describe('handleInboundEvent', () => {
  it('sem flow ativo: só persiste a mensagem e não chama OpenWA', async () => {
    const supabase = makeSupabase({
      leads: { select: { data: { id: 'lead-1' }, error: null } },
      conversations: {
        select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
      },
      messages: { insert: { data: null, error: null } },
      flows: { select: { data: null, error: null } },
    });
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
    const supabase = makeSupabase({
      leads: { select: { data: { id: 'lead-1' }, error: null } },
      conversations: {
        select: { data: { id: 'conv-1', context: {}, status: 'open', current_step_id: null }, error: null },
        update: { data: null, error: null },
      },
      messages: { insert: { data: null, error: null } },
      flows: { select: { data: flow, error: null } },
    });
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
    const supabase = makeSupabase({
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
    });
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
