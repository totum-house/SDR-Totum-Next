/**
 * webhook_handler.js — processa 1 evento inbound do OpenWA de ponta a ponta:
 * acha/cria lead + conversation, persiste a mensagem, roda flow_runner,
 * persiste os updates e envia as respostas de volta via OpenWA.
 *
 * Puro em relação a I/O real: supabase + openwa + logger são injetados,
 * o que permite testar sem rede/banco (mesmo padrão de flow_runner.js).
 */

const { createRunner } = require('./flow_runner');
const { generate: llmGenerate } = require('./llm_provider');
const manusClient = require('./manus_client');

/**
 * Contrato ASSUMIDO do payload do webhook OpenWA (wa-automate-like) —
 * a validar contra o gateway real. Ver docs/OPENWA_API.md.
 */
function parseInboundEvent(body) {
  const from = body?.from || body?.sender?.id || body?.author || null;
  const text = body?.body ?? body?.text ?? body?.content ?? '';
  const messageId = body?.id || body?.messageId || null;
  if (!from) return null;
  const phone = String(from).replace(/@c\.us$|@g\.us$/, '');
  return { phone_e164: phone, text: String(text || ''), openwa_message_id: messageId };
}

async function findOrCreateLead(supabase, workspaceId, phone) {
  const { data: existing, error: findErr } = await supabase
    .from('leads')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('phone_e164', phone)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing;

  const { data: created, error: insertErr } = await supabase
    .from('leads')
    .insert({ workspace_id: workspaceId, phone_e164: phone, source: 'openwa_webhook' })
    .select()
    .single();
  if (insertErr) throw insertErr;
  return created;
}

async function findOrCreateConversation(supabase, workspaceId, lead) {
  const { data: existing, error: findErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('lead_id', lead.id)
    .eq('status', 'open')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing;

  const { data: created, error: insertErr } = await supabase
    .from('conversations')
    .insert({ workspace_id: workspaceId, lead_id: lead.id })
    .select()
    .single();
  if (insertErr) throw insertErr;
  return created;
}

async function findActiveFlow(supabase, workspaceId) {
  const { data, error } = await supabase
    .from('flows')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Roda um step do flow e materializa o resultado: persiste os updates da
 * conversation, grava cada outbound em messages e envia via OpenWA.
 *
 * Compartilhado entre o webhook (inbound do lead) e o dispatch manual
 * (sem inbound) — a única diferença entre os dois é o inboundText.
 */
async function runFlowStep({ supabase, openwa, flow, conversation, phone, inboundText, logger }) {
  const runner = createRunner({ llmGenerate, manusClient, logger });
  const result = await runner.step({ flow, conversation, inboundText });

  const nextContext = { ...(conversation.context || {}), ...result.updates };
  const { error: updateErr } = await supabase
    .from('conversations')
    .update({
      current_step_id: result.nextStepId,
      current_flow_id: flow.id,
      context: nextContext,
      status: result.done ? 'closed' : conversation.status,
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);
  if (updateErr) throw updateErr;

  for (const msg of result.outboundMessages) {
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      content: msg.text,
      message_type: msg.type || 'text',
    });
    await openwa.sendMessage(phone, msg.text);
  }

  return { ok: true, outbound: result.outboundMessages.length, done: result.done };
}

async function handleInboundEvent({ body, workspaceId, supabase, openwa, logger = console }) {
  const parsed = parseInboundEvent(body);
  if (!parsed) {
    logger.warn('[webhook] evento sem remetente reconhecível, ignorado');
    return { ok: true, skipped: 'no_sender' };
  }

  const lead = await findOrCreateLead(supabase, workspaceId, parsed.phone_e164);
  const conversation = await findOrCreateConversation(supabase, workspaceId, lead);

  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    content: parsed.text,
    openwa_message_id: parsed.openwa_message_id,
  });

  const flow = await findActiveFlow(supabase, workspaceId);
  if (!flow) {
    logger.warn(`[webhook] workspace ${workspaceId} sem flow ativo — mensagem só persistida`);
    return { ok: true, persisted: true, flow: null };
  }

  return runFlowStep({
    supabase,
    openwa,
    flow,
    conversation,
    phone: parsed.phone_e164,
    inboundText: parsed.text,
    logger,
  });
}

/**
 * Dispatch manual: força um step do flow para um lead existente, sem
 * mensagem inbound. Usado para iniciar conversa outbound (ex: primeira
 * abordagem) ou destravar uma conversation parada.
 */
async function dispatchToLead({ leadId, workspaceId, supabase, openwa, logger = console }) {
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', leadId)
    .maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return { ok: false, error: 'lead_not_found' };

  const conversation = await findOrCreateConversation(supabase, workspaceId, lead);

  const flow = await findActiveFlow(supabase, workspaceId);
  if (!flow) {
    logger.warn(`[dispatch] workspace ${workspaceId} sem flow ativo`);
    return { ok: false, error: 'no_active_flow' };
  }

  return runFlowStep({
    supabase,
    openwa,
    flow,
    conversation,
    phone: lead.phone_e164,
    inboundText: null,
    logger,
  });
}

module.exports = { handleInboundEvent, dispatchToLead, parseInboundEvent };
