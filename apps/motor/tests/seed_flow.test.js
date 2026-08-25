/**
 * seed_flow.test.js — teste de integração entre o seed SQL e o runner.
 *
 * Lê o graph que está DENTRO de packages/db/seed/001_demo_workspace_flow.sql
 * e executa no flow_runner real. Serve pra pegar drift: se alguém mexer no
 * seed (ou nos node types do runner) e o flow parar de rodar, quebra aqui em
 * vez de quebrar em produção com o lead do outro lado.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../src/flow_runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(here, '../../../packages/db/seed/001_demo_workspace_flow.sql');

function graphFromSeed() {
  const sql = fs.readFileSync(SEED, 'utf8');
  const m = sql.match(/'(\{[\s\S]*?\})'::jsonb/);
  if (!m) throw new Error('graph jsonb não encontrado no seed');
  return JSON.parse(m[1]);
}

/** Roda o flow até terminar, devolvendo as mensagens e o context final. */
async function runToCompletion(flow, inboundByStep) {
  const runner = createRunner();
  let conversation = { current_step_id: null, context: {}, status: 'open' };
  const outbound = [];

  for (let step = 0; step < 10; step++) {
    const r = await runner.step({
      flow,
      conversation,
      inboundText: inboundByStep[step] ?? null,
    });
    r.outboundMessages.forEach((m) => outbound.push(m.text));
    conversation = {
      ...conversation,
      current_step_id: r.nextStepId,
      context: { ...conversation.context, ...r.updates },
    };
    if (r.done) return { outbound, context: conversation.context, done: true };
    if (!r.nextStepId) break;
  }
  return { outbound, context: conversation.context, done: false };
}

describe('seed 001_demo_workspace_flow', () => {
  it('o SQL do seed contém um graph JSON válido', () => {
    const g = graphFromSeed();
    expect(g.entry_step_id).toBe('msg_saudacao');
    expect(Array.isArray(g.nodes)).toBe(true);
    expect(Array.isArray(g.edges)).toBe(true);
  });

  it('todo edge aponta para um node existente', () => {
    const g = graphFromSeed();
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source), `source órfão: ${e.source}`).toBe(true);
      expect(ids.has(e.target), `target órfão: ${e.target}`).toBe(true);
    }
    expect(ids.has(g.entry_step_id)).toBe(true);
  });

  it('só usa node types que o runner sabe executar', () => {
    const supported = new Set([
      'message', 'question', 'condition', 'improvise_with_goal', 'call_manus', 'end',
    ]);
    for (const n of graphFromSeed().nodes) {
      expect(supported.has(n.type), `type não suportado: ${n.type}`).toBe(true);
    }
  });

  it('executa ponta a ponta: saúda, captura o nome e despede usando o nome', async () => {
    const flow = { id: 'flow-seed', graph: graphFromSeed() };
    // step 2 é quando a pergunta já foi feita e o lead responde
    const { outbound, context, done } = await runToCompletion(flow, [null, null, 'Rael']);

    expect(done).toBe(true);
    expect(context.lead_name).toBe('Rael');
    expect(outbound).toHaveLength(3);
    expect(outbound[0]).toMatch(/Totum/);
    expect(outbound[1]).toMatch(/chamar/i);
    // prova que save_as → context → renderTemplate fecha o ciclo
    expect(outbound[2]).toContain('Rael');
    expect(outbound[2]).not.toContain('{{');
  });
});
