/**
 * flow_runner.js — executa o graph de um flow por conversation.
 *
 * Node types suportados:
 *   - message              envia texto fixo (com template {{var}})
 *   - question             envia pergunta e aguarda próxima inbound
 *   - condition            avalia expressão simples em context, escolhe branch
 *   - improvise_with_goal  LLM autorizado a responder livre até bater criteria
 *   - call_manus           delega pra Manus e continua com output no context
 *   - end                  encerra o flow (marca conversation.status = 'closed')
 *
 * Contrato:
 *   const runner = createRunner({ llmGenerate, manusClient, sender, logger });
 *   const result = await runner.step({ flow, conversation, inboundText });
 *   // → { outboundMessages: [...], nextStepId, done, updates: {...} }
 *
 * O runner é PURO em relação a I/O de banco: quem persiste `updates` é o
 * server.js. Isso facilita testar sem Supabase.
 */

// Texto vindo do lead entra no context e é interpolado nos prompts do LLM
// (stepImprovise monta o prompt com __history + inboundText). Sem limite,
// uma mensagem gigante estoura o context window; sem escape, o lead pode
// forjar tags de sistema e tentar prompt injection.
const MAX_INBOUND_LEN = 2000;

// Teto da resposta gerada pelo LLM antes de virar mensagem de WhatsApp.
// Mensagem de SDR é curta por design; um LLM que "derrapa" e devolve um
// muro de texto queima o número no warm-up e denuncia o bot.
const MAX_REPLY_LEN = 900;

const REPLY_FALLBACK = 'Deixa eu te responder j\u00e1 j\u00e1 \ud83d\ude0a';

/**
 * Guardrail do output do LLM antes de ir pro lead.
 *
 * - descarta cercas de c\u00f3digo e marca\u00e7\u00e3o tipo tag que vazam do modelo
 * - remove controles e colapsa espa\u00e7o em excesso
 * - corta em MAX_REPLY_LEN na \u00faltima fronteira de frase/palavra, pra n\u00e3o
 *   mandar mensagem cortada no meio da palavra
 * - devolve o fallback se sobrar vazio
 */
function sanitizeLlmReply(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/```/g, ' ');
  s = s.replace(/<[^>]{0,80}>/g, ' ');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  if (s.length > MAX_REPLY_LEN) {
    const head = s.slice(0, MAX_REPLY_LEN);
    const lastSentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    const cut = lastSentence > MAX_REPLY_LEN * 0.5 ? lastSentence + 1 : head.lastIndexOf(' ');
    s = (cut > 0 ? head.slice(0, cut) : head).trim();
  }

  return s || REPLY_FALLBACK;
}

/**
 * Sanitiza texto vindo do lead antes de gravar em context.
 *
 * - remove caracteres de controle (menos \n e \t)
 * - neutraliza `<...>` virando `‹...›` — preserva o que a pessoa escreveu
 *   de forma legível, mas impede que o texto se passe por tag de sistema
 * - trunca em MAX_INBOUND_LEN, marcando o corte
 */
function sanitizeInbound(text) {
  if (text == null) return text;
  let s = String(text);
  // Remove controles C0/C1 preservando \n e \t.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
  s = s.replace(/</g, '\u2039').replace(/>/g, '\u203A');
  if (s.length > MAX_INBOUND_LEN) {
    s = `${s.slice(0, MAX_INBOUND_LEN)}\u2026[truncado]`;
  }
  return s;
}

function renderTemplate(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => {
    const parts = k.split('.');
    let v = vars;
    for (const p of parts) {
      if (v == null) return m;
      v = v[p];
    }
    return v === undefined || v === null || v === '' ? m : String(v);
  });
}

function findNode(flow, stepId) {
  const nodes = (flow.graph && flow.graph.nodes) || [];
  return nodes.find((n) => n.id === stepId) || null;
}

function findEdgeTarget(flow, fromId, branch = null) {
  const edges = (flow.graph && flow.graph.edges) || [];
  const match = edges.find(
    (e) => e.source === fromId && (branch == null || e.branch === branch)
  );
  return match ? match.target : null;
}

function evalCondition(expr, context) {
  // Micro-DSL: `context.foo == "bar"` | `context.x > 3` | `context.y != null`
  // Não usa eval(); parse manual muito simples.
  const m = String(expr || '').match(/^\s*context\.([\w.-]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
  if (!m) return false;
  const [, path, op, rhsRaw] = m;
  const lhs = path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), context);
  let rhs = rhsRaw.trim();
  if (rhs === 'null') rhs = null;
  else if (rhs === 'true') rhs = true;
  else if (rhs === 'false') rhs = false;
  else if (/^-?\d+(\.\d+)?$/.test(rhs)) rhs = Number(rhs);
  else if (/^"(.*)"$/.test(rhs) || /^'(.*)'$/.test(rhs)) rhs = rhs.slice(1, -1);
  switch (op) {
    case '==': return lhs == rhs; // eslint-disable-line eqeqeq
    case '!=': return lhs != rhs; // eslint-disable-line eqeqeq
    case '>':  return lhs > rhs;
    case '<':  return lhs < rhs;
    case '>=': return lhs >= rhs;
    case '<=': return lhs <= rhs;
    default:   return false;
  }
}

/**
 * Fábrica: injeta dependências para permitir testes com mocks.
 */
function createRunner({ llmGenerate, manusClient, logger = console } = {}) {
  async function stepMessage(node, ctx) {
    const text = renderTemplate(node.text || '', ctx);
    return {
      outboundMessages: [{ text, type: 'text' }],
      nextStepId: findEdgeTarget({ graph: ctx.__flow.graph }, node.id),
      done: false,
      updates: {},
    };
  }

  async function stepQuestion(node, ctx, inboundText) {
    // Se ainda não veio inbound, envia a pergunta e aguarda
    if (!inboundText) {
      const text = renderTemplate(node.text || '', ctx);
      return {
        outboundMessages: [{ text, type: 'text' }],
        nextStepId: node.id, // permanece no mesmo nó aguardando resposta
        done: false,
        updates: { awaiting_inbound: true },
      };
    }
    // Chegou inbound: grava em context[var_name] e avança.
    // Sanitiza antes de persistir — esse valor volta nos prompts do LLM.
    const updates = {};
    if (node.save_as) updates[node.save_as] = sanitizeInbound(inboundText);
    return {
      outboundMessages: [],
      nextStepId: findEdgeTarget({ graph: ctx.__flow.graph }, node.id),
      done: false,
      updates,
    };
  }

  async function stepCondition(node, ctx) {
    const branch = evalCondition(node.expr, ctx) ? 'true' : 'false';
    return {
      outboundMessages: [],
      nextStepId: findEdgeTarget({ graph: ctx.__flow.graph }, node.id, branch),
      done: false,
      updates: {},
    };
  }

  async function stepImprovise(node, ctx, inboundText) {
    const turnsSoFar = ctx.__improvise_turns || 0;
    const maxTurns = Number(node.max_turns || 3);
    if (turnsSoFar >= maxTurns) {
      logger.warn(`[flow] improvise_with_goal ${node.id} estourou max_turns=${maxTurns}, indo fallback`);
      return {
        outboundMessages: [],
        nextStepId: node.fallback_step_id || null,
        done: false,
        updates: { __improvise_turns: 0 },
      };
    }
    const prompt = [
      `Você é um SDR consultivo Totum no WhatsApp (BR, curto, humano).`,
      `OBJETIVO deste passo: ${node.goal}`,
      `CRITÉRIOS DE SUCESSO (todos devem ser atendidos):`,
      ...(node.success_criteria || []).map((c) => `- ${c}`),
      ``,
      `Histórico da conversa:`,
      // Conteúdo escrito pelo lead é DADO, nunca instrução — sanitiza antes
      // de entrar no prompt pra ele não forjar tag de sistema.
      ...(ctx.__history || []).map((h) => `[${h.direction}] ${sanitizeInbound(h.content)}`),
      inboundText ? `\nÚltima mensagem do lead: ${sanitizeInbound(inboundText)}` : '',
      ``,
      `Responda um JSON válido: {"reply": "mensagem curta", "goal_reached": true|false}`,
    ].join('\n');
    if (!llmGenerate) throw new Error('flow_runner: llmGenerate não injetado');
    const raw = await llmGenerate(prompt);
    let parsed;
    try {
      const clean = String(raw).replace(/```json\n?/gi, '').replace(/```/g, '').trim();
      const s = clean.indexOf('{');
      const e = clean.lastIndexOf('}');
      parsed = JSON.parse(s >= 0 && e > s ? clean.slice(s, e + 1) : clean);
    } catch {
      parsed = { reply: REPLY_FALLBACK, goal_reached: false };
    }
    const reply = sanitizeLlmReply(parsed.reply);
    const reached = Boolean(parsed.goal_reached);
    if (reached) {
      return {
        outboundMessages: [{ text: reply, type: 'text' }],
        nextStepId: node.on_success_step_id || findEdgeTarget({ graph: ctx.__flow.graph }, node.id, 'success'),
        done: false,
        updates: { __improvise_turns: 0 },
      };
    }
    return {
      outboundMessages: [{ text: reply, type: 'text' }],
      nextStepId: node.id, // permanece esperando próxima inbound
      done: false,
      updates: { __improvise_turns: turnsSoFar + 1, awaiting_inbound: true },
    };
  }

  async function stepCallManus(node, ctx) {
    if (!manusClient || !manusClient.callManus) {
      throw new Error('flow_runner: manusClient não injetado');
    }
    const objective = renderTemplate(node.objective || '', ctx);
    const result = await manusClient.callManus({
      objective,
      context: ctx,
      timeout_ms: Number(node.timeout_ms || 60000),
    });
    const updates = {};
    if (node.save_as) updates[node.save_as] = result;
    return {
      outboundMessages: [],
      nextStepId: findEdgeTarget({ graph: ctx.__flow.graph }, node.id),
      done: false,
      updates,
    };
  }

  async function stepEnd() {
    return {
      outboundMessages: [],
      nextStepId: null,
      done: true,
      updates: { status: 'closed' },
    };
  }

  async function step({ flow, conversation, inboundText = null }) {
    const stepId = conversation.current_step_id || (flow.graph.entry_step_id || (flow.graph.nodes[0] && flow.graph.nodes[0].id));
    const node = findNode(flow, stepId);
    if (!node) throw new Error(`flow_runner: node não encontrado "${stepId}"`);

    const ctx = {
      ...(conversation.context || {}),
      __flow: flow,
      __history: conversation.__history || [],
    };

    switch (node.type) {
      case 'message':             return stepMessage(node, ctx);
      case 'question':            return stepQuestion(node, ctx, inboundText);
      case 'condition':           return stepCondition(node, ctx);
      case 'improvise_with_goal': return stepImprovise(node, ctx, inboundText);
      case 'call_manus':          return stepCallManus(node, ctx);
      case 'end':                 return stepEnd();
      default:
        throw new Error(`flow_runner: node.type desconhecido "${node.type}"`);
    }
  }

  return { step, renderTemplate, evalCondition };
}

module.exports = {
  createRunner,
  renderTemplate,
  evalCondition,
  findNode,
  findEdgeTarget,
  sanitizeInbound,
  sanitizeLlmReply,
};
