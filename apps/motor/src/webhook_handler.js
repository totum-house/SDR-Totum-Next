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
const { checkQuota, withWorkspaceLock } = require('./warmup');
const { getRules, effectiveDailyLimit, isKillSwitchOn } = require('./rules');
const { emitEvent, EVENT_TYPES } = require('./events');

/**
 * Contrato VERIFICADO em 2026-08-24 contra o gateway real
 * (rmyndharis/OpenWA). Dois fatos confirmados no Swagger
 * (127.0.0.1:2785/api/docs-json) e no endpoint oficial de teste
 * (POST /webhooks/{id}/test):
 *
 * 1) Todo webhook chega ENVELOPADO:
 *      { event, timestamp, sessionId, idempotencyKey, deliveryId, data }
 *    Os campos da mensagem ficam dentro de `data`, não no topo do body
 *    — testado com o endpoint oficial, que devolve exatamente essa
 *    forma. Sem isso, TODO evento real seria descartado em silêncio
 *    (`skipped: no_sender`), sem log de erro nenhum.
 *
 * 2) O formato de `data` para uma mensagem é o MessageListItemDto do
 *    Swagger: campos reais são `from`, `body`, `waMessageId` (id da
 *    mensagem no protocolo WhatsApp; `id` é o id interno do OpenWA,
 *    fallback quando waMessageId ainda não foi atribuído).
 *
 * Aceita também o payload sem envelope (`data` ausente), como rede de
 * segurança — não custa nada e cobre o caso de outra versão do
 * OpenWA mudar o formato de novo.
 */
function parseInboundEvent(body) {
  const msg = body?.data && typeof body.data === 'object' ? body.data : body;
  const from = msg?.from || msg?.author || null;
  const text = msg?.body ?? msg?.text ?? '';
  const messageId = msg?.waMessageId || msg?.id || null;
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

/**
 * `campaignId` só é usado na CRIAÇÃO. Uma conversation aberta que já
 * existe não é reetiquetada: se a pessoa já estava falando com o SDR,
 * quem começou aquela conversa foi ela, não a campanha — reescrever isso
 * faria o relatório da campanha reivindicar conversa que não iniciou.
 */
async function findOrCreateConversation(supabase, workspaceId, lead, campaignId = null) {
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

  const row = { workspace_id: workspaceId, lead_id: lead.id };
  if (campaignId) row.campaign_id = campaignId;

  const { data: created, error: insertErr } = await supabase
    .from('conversations')
    .insert(row)
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
async function runFlowStep({
  supabase,
  openwa,
  flow,
  conversation,
  workspaceId,
  phone,
  inboundText,
  campaign = null,
  rules = null,
  logger = console,
}) {
  const runner = createRunner({ llmGenerate, manusClient, logger });
  const result = await runner.step({ flow, conversation, inboundText });

  // LIMITAÇÃO CONHECIDA: current_step_id avança aqui, ANTES de saber se o
  // envio abaixo vai dar certo. Se o send falhar, a conversation fica
  // pensando que já mandou a mensagem deste step — sem retry nem rollback
  // desse avanço. Aceitável por ora porque OpenWA tem os próprios pacing/
  // circuit breaker (reduz chance de falha de envio isolada) e a
  // consequência hoje é "resposta perdida", não corrupção de dado. Reverter
  // o avanço só no caminho de falha muda o formato do resultado de
  // runner.step (hoje é side-effect-free) — fica pra quando isso for
  // observado em produção de verdade, não em teoria.
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

  // Trava de warm-up: checa a cota, envia e persiste como UMA unidade,
  // serializada por workspace via withWorkspaceLock. checkQuota() sozinho
  // é check-then-act — sob chamadas concorrentes (ex: rajada de webhooks),
  // várias passariam pelo SELECT antes de qualquer uma persistir seu
  // insert, todas vendo "ainda tem vaga" (incidente real, 2026-08-24: 10
  // mensagens saíram com WARMUP_DAILY_LIMIT=2). O lock serializa esse
  // ciclo inteiro dentro do processo — ver warmup.js.
  //
  // O teto e o kill switch vêm de rules.js (YAML + banco + env, já
  // reduzidos pelo hard cap). Carregar aqui quando não veio pronto faz
  // com que o kill switch pare TAMBÉM as respostas a quem escreveu —
  // "para tudo" tem que significar tudo, não só campanha.
  const effectiveRules = rules || (await getRules({ supabase, workspaceId, logger }));
  const quotaLimit = effectiveDailyLimit({ rules: effectiveRules, campaign });
  const killed = isKillSwitchOn(effectiveRules);

  let sent = 0;
  let blocked = null;
  let sendError = null;
  for (const msg of result.outboundMessages) {
    const outcome = await withWorkspaceLock(workspaceId, async () => {
      const quota = await checkQuota({ supabase, workspaceId, limit: quotaLimit, killed });
      if (!quota.allowed) return { blocked: quota.reason };

      // sendMessage ANTES do insert: só grava em messages o que realmente
      // saiu. Erro aqui NÃO propaga — devolver 500 pro OpenWA dispararia
      // o retry automático dele (retryCount:3), reprocessando o MESMO
      // evento inbound como se fosse novo. Num flow com `question`
      // pendente, isso gravaria o texto do lead como resposta errada.
      try {
        await openwa.sendMessage(phone, msg.text);
      } catch (err) {
        return { sendError: err.message };
      }

      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        content: msg.text,
        message_type: msg.type || 'text',
      });
      return { sent: true };
    });

    if (outcome.blocked) {
      blocked = outcome.blocked;
      logger.warn(
        `[warmup] envio bloqueado (${outcome.blocked}) — ${result.outboundMessages.length - sent} mensagem(ns) não enviada(s)`
      );
      emitEvent(
        outcome.blocked === 'kill_switch' ? EVENT_TYPES.KILL_SWITCH : EVENT_TYPES.QUOTA_BLOCKED,
        {
          reason: outcome.blocked,
          phone,
          conversation_id: conversation.id,
          campaign_id: campaign?.id || null,
          limit: quotaLimit,
        }
      );
      break;
    }
    if (outcome.sendError) {
      sendError = outcome.sendError;
      logger.error(
        `[webhook] falha ao enviar via OpenWA (mensagem NÃO persistida): ${outcome.sendError}`
      );
      emitEvent(EVENT_TYPES.SEND_ERROR, {
        error: outcome.sendError,
        phone,
        conversation_id: conversation.id,
        campaign_id: campaign?.id || null,
      });
      break;
    }
    sent += 1;
    emitEvent(EVENT_TYPES.OUTBOUND_SENT, {
      phone,
      content: msg.text,
      conversation_id: conversation.id,
      campaign_id: campaign?.id || null,
      step_id: conversation.current_step_id || null,
    });
  }

  return {
    ok: true,
    outbound: sent,
    done: result.done,
    ...(blocked ? { warmup_blocked: blocked } : {}),
    ...(sendError ? { send_error: sendError } : {}),
  };
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

  emitEvent(EVENT_TYPES.INBOUND_RECEIVED, {
    phone: parsed.phone_e164,
    content: parsed.text,
    conversation_id: conversation.id,
    campaign_id: conversation.campaign_id || null,
    lead_id: lead.id,
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
    workspaceId,
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
    workspaceId,
    phone: lead.phone_e164,
    inboundText: null,
    logger,
  });
}

module.exports = {
  handleInboundEvent,
  dispatchToLead,
  parseInboundEvent,
  // Exportados para o campaign_runner: ele precisa do MESMO caminho de
  // execução do webhook (cota, lock, persistência, eventos), só que
  // partindo do flow da campanha em vez do flow ativo do workspace.
  runFlowStep,
  findOrCreateConversation,
  findOrCreateLead,
  findActiveFlow,
};
