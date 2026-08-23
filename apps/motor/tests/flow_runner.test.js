/**
 * flow_runner.test.js — cobre 4 tipos de nó com mocks.
 * Rodar: pnpm --filter @sdr-next/motor test
 */

import { describe, it, expect, vi } from 'vitest';
import { createRunner, renderTemplate, evalCondition, findEdgeTarget } from '../src/flow_runner.js';

const baseFlow = {
  id: 'flow-1',
  graph: {
    entry_step_id: 'msg1',
    nodes: [
      { id: 'msg1', type: 'message', text: 'Olá {{lead_name}}, tudo bem?' },
      { id: 'q1',   type: 'question', text: 'Qual seu cargo?', save_as: 'cargo' },
      { id: 'cond1', type: 'condition', expr: 'context.cargo == "CEO"' },
      { id: 'imp1', type: 'improvise_with_goal',
        goal: 'descobrir o setor da empresa',
        success_criteria: ['mensagem contém setor'],
        max_turns: 2,
        fallback_step_id: 'end1',
        on_success_step_id: 'end1',
      },
      { id: 'mns1', type: 'call_manus', objective: 'Pesquisar CNPJ {{cargo}}', save_as: 'cnpj_data' },
      { id: 'end1', type: 'end' },
    ],
    edges: [
      { source: 'msg1', target: 'q1' },
      { source: 'q1',   target: 'cond1' },
      { source: 'cond1', target: 'imp1', branch: 'true' },
      { source: 'cond1', target: 'end1', branch: 'false' },
      { source: 'mns1', target: 'end1' },
    ],
  },
};

describe('renderTemplate', () => {
  it('substitui variáveis simples', () => {
    expect(renderTemplate('Oi {{nome}}', { nome: 'Rael' })).toBe('Oi Rael');
  });
  it('mantém placeholder quando variável ausente', () => {
    expect(renderTemplate('Oi {{nome}}', {})).toBe('Oi {{nome}}');
  });
  it('resolve caminho aninhado', () => {
    expect(renderTemplate('CNPJ {{data.cnpj}}', { data: { cnpj: '123' } })).toBe('CNPJ 123');
  });
});

describe('evalCondition', () => {
  it('igualdade string', () => {
    expect(evalCondition('context.cargo == "CEO"', { cargo: 'CEO' })).toBe(true);
    expect(evalCondition('context.cargo == "CEO"', { cargo: 'Dev' })).toBe(false);
  });
  it('comparação numérica', () => {
    expect(evalCondition('context.score > 5', { score: 8 })).toBe(true);
    expect(evalCondition('context.score > 5', { score: 3 })).toBe(false);
  });
  it('null check', () => {
    expect(evalCondition('context.foo != null', { foo: 'x' })).toBe(true);
    expect(evalCondition('context.foo != null', {})).toBe(false);
  });
});

describe('findEdgeTarget', () => {
  it('acha edge sem branch', () => {
    expect(findEdgeTarget(baseFlow, 'msg1')).toBe('q1');
  });
  it('acha edge com branch true', () => {
    expect(findEdgeTarget(baseFlow, 'cond1', 'true')).toBe('imp1');
  });
  it('retorna null se nada casar', () => {
    expect(findEdgeTarget(baseFlow, 'end1')).toBe(null);
  });
});

describe('runner.step — message', () => {
  it('envia texto e avança pro próximo', async () => {
    const runner = createRunner();
    const result = await runner.step({
      flow: baseFlow,
      conversation: { current_step_id: 'msg1', context: { lead_name: 'Rael' } },
    });
    expect(result.outboundMessages).toEqual([{ text: 'Olá Rael, tudo bem?', type: 'text' }]);
    expect(result.nextStepId).toBe('q1');
    expect(result.done).toBe(false);
  });
});

describe('runner.step — question', () => {
  const runner = createRunner();

  it('sem inbound: envia pergunta e permanece', async () => {
    const result = await runner.step({
      flow: baseFlow,
      conversation: { current_step_id: 'q1', context: {} },
    });
    expect(result.outboundMessages).toEqual([{ text: 'Qual seu cargo?', type: 'text' }]);
    expect(result.nextStepId).toBe('q1');
    expect(result.updates.awaiting_inbound).toBe(true);
  });

  it('com inbound: salva e avança', async () => {
    const result = await runner.step({
      flow: baseFlow,
      conversation: { current_step_id: 'q1', context: {} },
      inboundText: 'CEO',
    });
    expect(result.outboundMessages).toEqual([]);
    expect(result.updates).toEqual({ cargo: 'CEO' });
    expect(result.nextStepId).toBe('cond1');
  });
});

describe('runner.step — improvise_with_goal', () => {
  it('goal_reached=true segue on_success_step_id', async () => {
    const llmGenerate = vi.fn().mockResolvedValue(JSON.stringify({
      reply: 'Legal! Vocês são de tecnologia certo?',
      goal_reached: true,
    }));
    const runner = createRunner({ llmGenerate });
    const result = await runner.step({
      flow: baseFlow,
      conversation: { current_step_id: 'imp1', context: { cargo: 'CEO' } },
      inboundText: 'Sim, somos de SaaS',
    });
    expect(llmGenerate).toHaveBeenCalledOnce();
    expect(result.outboundMessages[0].text).toMatch(/tecnologia/i);
    expect(result.nextStepId).toBe('end1');
    expect(result.updates.__improvise_turns).toBe(0);
  });

  it('goal_reached=false permanece e incrementa turno', async () => {
    const llmGenerate = vi.fn().mockResolvedValue(JSON.stringify({
      reply: 'E qual é o segmento?',
      goal_reached: false,
    }));
    const runner = createRunner({ llmGenerate });
    const result = await runner.step({
      flow: baseFlow,
      conversation: { current_step_id: 'imp1', context: { __improvise_turns: 0 } },
      inboundText: 'Trabalhamos com clientes',
    });
    expect(result.nextStepId).toBe('imp1');
    expect(result.updates.__improvise_turns).toBe(1);
    expect(result.updates.awaiting_inbound).toBe(true);
  });

  it('estourou max_turns: vai fallback', async () => {
    const llmGenerate = vi.fn();
    const runner = createRunner({ llmGenerate });
    const result = await runner.step({
      flow: baseFlow,
      conversation: { current_step_id: 'imp1', context: { __improvise_turns: 2 } },
      inboundText: 'sla',
    });
    expect(llmGenerate).not.toHaveBeenCalled();
    expect(result.nextStepId).toBe('end1');
  });
});

describe('runner.step — call_manus', () => {
  it('chama manusClient e salva output', async () => {
    const manusClient = {
      callManus: vi.fn().mockResolvedValue({ result: { cnpj: '11.222.333/0001-44' } }),
    };
    const runner = createRunner({ manusClient });
    const result = await runner.step({
      flow: baseFlow,
      conversation: { current_step_id: 'mns1', context: { cargo: 'CEO' } },
    });
    expect(manusClient.callManus).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'Pesquisar CNPJ CEO',
    }));
    expect(result.updates.cnpj_data).toEqual({ result: { cnpj: '11.222.333/0001-44' } });
    expect(result.nextStepId).toBe('end1');
  });
});

describe('runner.step — end', () => {
  it('marca conversation como closed', async () => {
    const runner = createRunner();
    const result = await runner.step({
      flow: baseFlow,
      conversation: { current_step_id: 'end1', context: {} },
    });
    expect(result.done).toBe(true);
    expect(result.updates.status).toBe('closed');
    expect(result.nextStepId).toBe(null);
  });
});
