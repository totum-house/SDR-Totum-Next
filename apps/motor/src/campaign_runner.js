/**
 * campaign_runner.js — o laço que faz o motor agir sozinho.
 *
 * Até este arquivo existir, o motor era 100% reativo: só falava quando o
 * lead falava primeiro (webhook_handler.handleInboundEvent). Campanha é o
 * caminho inverso — pegar a fila de leads e começar a conversa.
 *
 * O ciclo, uma vez a cada tick:
 *
 *   1. relê as rules (cache de 10s — rules.js)
 *   2. kill switch ligado?          → não faz nada, nem olha o banco
 *   3. tem campanha 'running'?      → não, dorme
 *   4. está dentro da janela?       → não, dorme (ninguém prospecta 3h da manhã)
 *   5. ainda tem cota hoje?         → não, dorme até amanhã
 *   6. pega o próximo da fila       → fila vazia? campanha vira 'done'
 *   7. dispara pelo MESMO caminho do webhook (cota, lock, persistência)
 *   8. dorme um jitter de 30-120s antes de considerar o próximo
 *
 * POR QUE O DISPARO REUSA runFlowStep
 *
 * A trava de warm-up mora lá dentro (withWorkspaceLock + checkQuota, a
 * correção do incidente de 2026-08-24). Um caminho de envio paralelo
 * seria um segundo lugar por onde mensagem sai sem passar pela mesma
 * trava — que é exatamente o formato do bug que já aconteceu uma vez.
 * Campanha e resposta usam o mesmo funil; a única diferença é de onde
 * vem o flow e se existe inboundText.
 *
 * PARAR EM MENOS DE 30s
 *
 * O jitter entre mensagens chega a 120s, e um `setTimeout(120s)` deixaria
 * o motor surdo por dois minutos depois de o Rael apertar o kill switch.
 * Por isso toda espera passa por sleepUnlessKilled, que acorda a cada 2s
 * só para reperguntar. Pior caso real: 2s de fatia + até 10s de cache das
 * rules = 12s.
 */

const {
  getRules,
  isKillSwitchOn,
  isWithinWindow,
  effectiveDailyLimit,
  nextJitterMs,
  sleepUnlessKilled,
} = require('./rules');
const { countOutboundToday } = require('./warmup');
const { runFlowStep, findOrCreateConversation } = require('./webhook_handler');
const { emitEvent, EVENT_TYPES } = require('./events');

// Espera entre ticks quando NÃO houve disparo (sem campanha, fora da
// janela, cota estourada). Curto o bastante para o painel refletir um
// "iniciar campanha" quase na hora, longo o bastante para não virar
// polling agressivo no Supabase.
const IDLE_TICK_MS = 10_000;

// Tentativas por lead antes de desistir. Falha de rede no gateway é
// transitória e não deveria queimar o lead para sempre; falha que
// persiste em 3 tentativas é problema de dado (número inválido) ou de
// configuração, e aí insistir só gasta cota do chip.
const MAX_ATTEMPTS = 3;

/**
 * `rulesProvider` é injetável pelo mesmo motivo que llmGenerate e sender
 * são em flow_runner.js: o teste do ciclo de campanha não deveria
 * depender de arquivo YAML, env var nem do cache de 10s do rules.js —
 * essas três coisas já têm testes próprios em rules.test.js.
 */
function createCampaignRunner({
  supabase,
  openwa,
  workspaceId,
  logger = console,
  tickIdleMs = IDLE_TICK_MS,
  rand = Math.random,
  rulesProvider = getRules,
}) {
  if (!supabase) throw new Error('campaign_runner: supabase obrigatório');
  if (!workspaceId) throw new Error('campaign_runner: workspaceId obrigatório');

  let running = false;
  let loopPromise = null;
  let lastStatus = null;

  /** Só publica no /live quando o estado MUDA — senão o ring buffer
   *  vira 200 linhas de "idle" e engole o histórico útil. */
  function emitStatusChange(status, extra = {}) {
    if (status === lastStatus) return;
    lastStatus = status;
    emitEvent(EVENT_TYPES.CAMPAIGN_TICK, { status, ...extra });
  }

  async function isKilled() {
    const rules = await rulesProvider({ supabase, workspaceId, logger });
    return isKillSwitchOn(rules);
  }

  async function findRunningCampaign() {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'running')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function loadFlow(flowId) {
    const { data, error } = await supabase
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  /**
   * Reivindica o próximo da fila com um UPDATE condicional em vez de
   * SELECT-depois-UPDATE: o `.eq('status','queued')` faz o próprio banco
   * recusar a segunda reivindicação da mesma linha. Se voltar vazio,
   * outro caminho já pegou — segue para o próximo tick sem reclamar.
   *
   * Marcar como 'dispatched' ANTES de enviar é deliberado: se o processo
   * morrer no meio do envio, o pior caso vira "um lead não recebeu"
   * (visível na fila, requeue manual), e não "o lead recebeu duas vezes"
   * — que no WhatsApp é o erro que queima número.
   */
  async function claimNextLead(campaignId) {
    const { data: candidate, error: pickErr } = await supabase
      .from('campaign_leads')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('status', 'queued')
      .order('queued_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (pickErr) throw pickErr;
    if (!candidate) return null;

    const { data: claimed, error: claimErr } = await supabase
      .from('campaign_leads')
      .update({
        status: 'dispatched',
        attempts: (candidate.attempts || 0) + 1,
        dispatched_at: new Date().toISOString(),
      })
      .eq('id', candidate.id)
      .eq('status', 'queued')
      .select()
      .maybeSingle();
    if (claimErr) throw claimErr;
    return claimed || null;
  }

  async function loadLead(leadId) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', leadId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  /** Devolve o lead para a fila (bloqueio de cota, ou erro ainda com
   *  tentativas de sobra). Sem isso, um bloqueio de cota consumiria o
   *  lead sem ter mandado nada para ele. */
  async function requeue(claimId, lastError = null) {
    await supabase
      .from('campaign_leads')
      .update({ status: 'queued', dispatched_at: null, last_error: lastError })
      .eq('id', claimId);
  }

  async function markFailed(claimId, lastError) {
    await supabase
      .from('campaign_leads')
      .update({ status: 'failed', last_error: lastError })
      .eq('id', claimId);
  }

  async function dispatchOne({ campaign, rules, claim }) {
    const lead = await loadLead(claim.lead_id);
    if (!lead) {
      await markFailed(claim.id, 'lead_not_found');
      return { status: 'lead_not_found' };
    }

    const flow = await loadFlow(campaign.flow_id);
    if (!flow) {
      // Flow sumiu debaixo da campanha: devolve o lead e para a campanha.
      // Continuar tentando gastaria a fila inteira em erro.
      await requeue(claim.id, 'flow_not_found');
      await supabase.from('campaigns').update({ status: 'paused' }).eq('id', campaign.id);
      logger.error(`[campanha] flow ${campaign.flow_id} não encontrado — campanha pausada`);
      return { status: 'flow_not_found' };
    }

    const conversation = await findOrCreateConversation(supabase, workspaceId, lead, campaign.id);

    await supabase
      .from('campaign_leads')
      .update({ conversation_id: conversation.id })
      .eq('id', claim.id);

    const result = await runFlowStep({
      supabase,
      openwa,
      flow,
      conversation,
      workspaceId,
      phone: lead.phone_e164,
      inboundText: null,
      campaign,
      rules,
      logger,
    });

    if (result.warmup_blocked) {
      await requeue(claim.id, `blocked:${result.warmup_blocked}`);
      return { status: 'blocked', reason: result.warmup_blocked };
    }

    if (result.send_error) {
      if ((claim.attempts || 1) < MAX_ATTEMPTS) {
        await requeue(claim.id, result.send_error);
        return { status: 'retry', error: result.send_error };
      }
      await markFailed(claim.id, result.send_error);
      return { status: 'failed', error: result.send_error };
    }

    return { status: 'dispatched', lead_id: lead.id, outbound: result.outbound };
  }

  /**
   * Uma passada do ciclo. Exposta separada do loop porque é o que dá
   * para testar sem timers — e é o que o endpoint de smoke test chama
   * para forçar um disparo sem esperar o jitter.
   */
  async function tick() {
    const rules = await rulesProvider({ supabase, workspaceId, logger });

    if (isKillSwitchOn(rules)) {
      emitStatusChange('killed');
      return { status: 'killed', rules };
    }

    const campaign = await findRunningCampaign();
    if (!campaign) {
      emitStatusChange('idle');
      return { status: 'idle', rules };
    }

    const window = isWithinWindow(rules, new Date());
    if (!window.allowed) {
      emitStatusChange('outside_window', { reason: window.reason, campaign_id: campaign.id });
      return { status: 'outside_window', reason: window.reason, rules, campaign };
    }

    const limit = effectiveDailyLimit({ rules, campaign });
    const sentToday = await countOutboundToday(supabase, workspaceId);
    if (sentToday >= limit) {
      emitStatusChange('quota_exhausted', { sent: sentToday, limit, campaign_id: campaign.id });
      return { status: 'quota_exhausted', sent: sentToday, limit, rules, campaign };
    }

    const claim = await claimNextLead(campaign.id);
    if (!claim) {
      // Fila vazia = campanha cumprida. 'done' em vez de deixar em
      // 'running' libera o índice parcial uq_campaigns_one_running para
      // a próxima campanha do workspace.
      await supabase
        .from('campaigns')
        .update({ status: 'done', stopped_at: new Date().toISOString() })
        .eq('id', campaign.id)
        .eq('status', 'running');
      emitEvent(EVENT_TYPES.CAMPAIGN_DONE, { campaign_id: campaign.id, name: campaign.name });
      lastStatus = null;
      return { status: 'campaign_done', campaign };
    }

    emitStatusChange('dispatching', { campaign_id: campaign.id });
    const outcome = await dispatchOne({ campaign, rules, claim });
    // Depois de um disparo o próximo tick é sempre "novidade": zera para
    // o CAMPAIGN_TICK seguinte voltar a ser publicado.
    lastStatus = null;
    return { ...outcome, rules, campaign, sent_today: sentToday, limit };
  }

  async function loop() {
    while (running) {
      let waitMs = tickIdleMs;
      try {
        const result = await tick();
        if (result.status === 'dispatched') {
          waitMs = nextJitterMs(result.rules, rand);
          logger.log(`[campanha] disparado — próximo em ${Math.round(waitMs / 1000)}s`);
        }
      } catch (err) {
        // Erro no ciclo NUNCA derruba o loop: banco fora do ar por 30s
        // não pode exigir restart manual do motor para a campanha voltar.
        logger.error(`[campanha] erro no tick: ${err.message}`);
        emitEvent(EVENT_TYPES.SEND_ERROR, { error: err.message, scope: 'campaign_tick' });
      }
      if (!running) break;
      await sleepUnlessKilled(waitMs, { isKilled });
    }
  }

  function start() {
    if (running) return loopPromise;
    running = true;
    lastStatus = null;
    logger.log(`[campanha] loop iniciado (workspace ${workspaceId})`);
    loopPromise = loop();
    return loopPromise;
  }

  async function stop() {
    running = false;
    await loopPromise;
    loopPromise = null;
    logger.log('[campanha] loop parado');
  }

  return { tick, start, stop, isKilled, isRunning: () => running };
}

module.exports = { createCampaignRunner, IDLE_TICK_MS, MAX_ATTEMPTS };
