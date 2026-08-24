/**
 * warmup.js — trava de volume de envio durante o warm-up do número WhatsApp.
 *
 * Por que existe: o número é um VoIP DID com sobrevivência estimada em
 * 65-75%. Estourar volume nos primeiros dias é a forma mais rápida de
 * perder o número — e aí nada do resto do sistema importa. A trava vive
 * no código, não na disciplina de quem opera.
 *
 * Schedule do SPEC (§3 FASE 7):
 *   dia 1-3   → 2 msgs/dia
 *   dia 4-7   → 5 msgs/dia
 *   dia 8-14  → 15 msgs/dia
 *   dia 15+   → escalando gradual
 *
 * O schedule NÃO é automático de propósito: subir a cota é decisão do
 * Rael (camada L11, 🔴 vermelho em docs/PROTOCOL_CAMADAS.md). Aqui só
 * se lê WARMUP_DAILY_LIMIT do env, e o default é o mais conservador.
 *
 * Envs:
 *   WARMUP_ENABLED=false   → kill switch total, bloqueia QUALQUER envio
 *   WARMUP_DAILY_LIMIT=2   → teto de mensagens outbound por dia (default 2)
 *
 * Nota: a cota conta TODO outbound do dia, inclusive resposta a quem
 * escreveu primeiro. Bloquear uma resposta é ruim de atendimento mas
 * seguro de ban — e durante o warm-up é exatamente o comportamento
 * desejado. Se quiser separar cold outbound de resposta, é aqui.
 */

const DEFAULT_DAILY_LIMIT = 2;

function startOfTodayISO(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dailyLimit() {
  const raw = process.env.WARMUP_DAILY_LIMIT;
  const n = Number(raw);
  if (!raw || Number.isNaN(n) || n < 0) return DEFAULT_DAILY_LIMIT;
  return n;
}

function isKillSwitchOn() {
  return String(process.env.WARMUP_ENABLED || 'true').toLowerCase() === 'false';
}

/**
 * Conta mensagens outbound já enviadas hoje no workspace.
 *
 * Faz em duas queries (conversations do workspace → messages dessas
 * conversations) porque supabase-js não faz join arbitrário. No volume
 * de warm-up isso é irrelevante; se um dia escalar, virar view/RPC.
 */
async function countOutboundToday(supabase, workspaceId, now = new Date()) {
  const { data: convs, error: convErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId);
  if (convErr) throw convErr;

  const ids = (convs || []).map((c) => c.id);
  if (ids.length === 0) return 0;

  const { count, error: msgErr } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .eq('direction', 'outbound')
    .gte('created_at', startOfTodayISO(now));
  if (msgErr) throw msgErr;

  return count || 0;
}

/**
 * Quantas mensagens ainda podem sair hoje.
 * → { allowed: boolean, remaining: number, reason?: string }
 */
async function checkQuota({ supabase, workspaceId, now = new Date() }) {
  if (isKillSwitchOn()) {
    return { allowed: false, remaining: 0, reason: 'kill_switch' };
  }
  const limit = dailyLimit();
  const sent = await countOutboundToday(supabase, workspaceId, now);
  const remaining = Math.max(0, limit - sent);
  return {
    allowed: remaining > 0,
    remaining,
    reason: remaining > 0 ? undefined : 'daily_limit',
  };
}

module.exports = { checkQuota, countOutboundToday, dailyLimit, isKillSwitchOn };
