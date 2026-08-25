/**
 * openwa_client.js — client HTTP para o gateway OpenWA (rmyndharis/OpenWA).
 *
 * Contrato VERIFICADO em 2026-08-24 contra o Swagger da instância real
 * (http://127.0.0.1:2785/api/docs-json). Não é mais suposição.
 *
 * Fatos do contrato que moldam este arquivo:
 *   - porta 2785, API sob /api (não 3000, não na raiz)
 *   - auth global por header `X-API-Key`
 *   - TUDO é escopado por sessão: /api/sessions/{sessionId}/...
 *   - envio de texto: POST /api/sessions/{id}/messages/send-text
 *     body { chatId: "<phone>@c.us", text } — text tem maxLength 4096
 *
 * Envs:
 *   OPENWA_URL         default http://127.0.0.1:2785
 *   OPENWA_API_KEY     obrigatório (header X-API-Key)
 *   OPENWA_SESSION_ID  obrigatório — a sessão que envia
 */

const axios = require('axios');

const OPENWA_URL = (process.env.OPENWA_URL || 'http://127.0.0.1:2785').replace(/\/$/, '');
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || '';
const OPENWA_SESSION_ID = process.env.OPENWA_SESSION_ID || '';

// Limite do próprio contrato (send-text.text.maxLength). O guardrail do
// flow_runner corta bem antes (MAX_REPLY_LEN=900); isto aqui é só a rede
// de proteção pra nunca tomar 400 do gateway.
const MAX_TEXT_LEN = 4096;

// Seam de teste: injeta um http client fake (post/get) em vez do axios real.
// Necessário porque este módulo usa require('axios') (CJS) e mockar o pacote
// via vi.mock/spyOn não intercepta esse caminho de forma confiável — mesmo
// espírito da injeção de dependência já usada em flow_runner.js/createRunner.
let _testHttpClient = null;
function __setHttpClientForTests(client) {
  _testHttpClient = client;
}

function api() {
  if (_testHttpClient) return _testHttpClient;
  const headers = { 'Content-Type': 'application/json' };
  if (OPENWA_API_KEY) headers['X-API-Key'] = OPENWA_API_KEY;
  return axios.create({ baseURL: `${OPENWA_URL}/api`, headers, timeout: 15000 });
}

/**
 * Modo mock (MOTOR_MOCK_SEND=true): o motor roda inteiro — flow, cota,
 * jitter, persistência, eventos do /live — mas nada sai no WhatsApp.
 *
 * Existe porque o gateway e o motor são entregáveis independentes: dá
 * para testar campanha, warm-up e painel antes de o número estar pronto,
 * e para ensaiar um flow novo sem gastar cota do chip em warm-up.
 *
 * A cota CONTINUA sendo contada no modo mock, de propósito: o ensaio só
 * vale se o comportamento observado for o mesmo do envio real.
 */
function isMockSend() {
  return String(process.env.MOTOR_MOCK_SEND || 'false').toLowerCase() === 'true';
}

function sessionId(explicit) {
  const id = explicit || OPENWA_SESSION_ID;
  if (!id) throw new Error('openwa_client: OPENWA_SESSION_ID não configurado');
  return id;
}

/**
 * Telefone → chatId no formato do WhatsApp.
 * Aceita já-formatado ("5511...@c.us") e devolve como está.
 */
function toChatId(phone) {
  const s = String(phone || '');
  if (s.includes('@')) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) throw new Error(`openwa_client: telefone inválido "${phone}"`);
  return `${digits}@c.us`;
}

/**
 * Envia texto. Assinatura mantida igual à versão anterior de propósito,
 * pra webhook_handler.js não precisar mudar.
 */
async function sendMessage(phone, text, opts = {}) {
  if (!text) throw new Error('openwa_client: text obrigatório');
  const body = {
    chatId: toChatId(phone),
    text: String(text).slice(0, MAX_TEXT_LEN),
  };
  if (opts.quotedMessageId) body.quotedMessageId = opts.quotedMessageId;

  if (isMockSend()) {
    console.log(`[openwa:mock] NÃO enviado → ${body.chatId}: ${body.text.slice(0, 120)}`);
    return { mocked: true, chatId: body.chatId };
  }

  const { data } = await api().post(
    `/sessions/${sessionId(opts.sessionId)}/messages/send-text`,
    body
  );
  return data;
}

/**
 * Confere se o número existe no WhatsApp ANTES de tentar enviar.
 *
 * Vale a chamada extra: disparar para número inexistente é um dos sinais
 * mais fortes de conta automatizada, e o número aqui é um VoIP DID em
 * warm-up. Erro de rede não bloqueia o envio (retorna null = "não sei").
 */
async function checkNumber(phone, opts = {}) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  try {
    const { data } = await api().get(
      `/sessions/${sessionId(opts.sessionId)}/contacts/check/${digits}`
    );
    if (typeof data === 'boolean') return data;
    return data?.exists ?? data?.isRegistered ?? data?.valid ?? null;
  } catch {
    return null;
  }
}

/**
 * Indicador "digitando...". Falha aqui nunca deve derrubar o envio —
 * é cosmético, então engole o erro.
 */
async function setTyping(phone, isTyping = true, opts = {}) {
  try {
    await api().post(`/sessions/${sessionId(opts.sessionId)}/chats/typing`, {
      chatId: toChatId(phone),
      typing: Boolean(isTyping),
    });
    return true;
  } catch {
    return false;
  }
}

async function getSessionStatus(opts = {}) {
  const { data } = await api().get(`/sessions/${sessionId(opts.sessionId)}/status`);
  return data;
}

module.exports = {
  sendMessage,
  isMockSend,
  checkNumber,
  setTyping,
  getSessionStatus,
  toChatId,
  MAX_TEXT_LEN,
  __setHttpClientForTests,
};
