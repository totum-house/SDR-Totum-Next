/**
 * events.js — barramento de eventos em processo, consumido pelo SSE /sse/live.
 *
 * O painel /live precisa ver "mensagem saiu", "lead respondeu", "envio
 * bloqueado pela cota", "erro no gateway" no instante em que acontecem.
 * Ler isso do banco em polling seria mais caro e mais lento do que o
 * motor simplesmente contar o que ele mesmo acabou de fazer.
 *
 * É in-process de propósito: o motor roda como 1 instância PM2
 * (ecosystem.config.cjs — instances: 1, exec_mode: fork), então não há
 * segundo processo com eventos a perder. Se um dia isso escalar para
 * múltiplas instâncias, este módulo vira o publisher de um canal
 * Supabase Realtime — o resto do código não muda, porque só chama emit().
 *
 * RING BUFFER: os últimos RING_SIZE eventos ficam em memória para o
 * painel que acabou de abrir não olhar para uma tela vazia até o próximo
 * disparo (que, em warm-up, pode demorar horas). Não é persistência —
 * reiniciou o motor, o histórico se foi. O histórico de verdade está em
 * totum_sdr.messages.
 */

const { EventEmitter } = require('node:events');

const RING_SIZE = 200;

/**
 * Estado pendurado num Symbol.for global, não em variáveis de módulo.
 *
 * Motivo: o mesmo arquivo pode ser carregado por dois registries no mesmo
 * processo — um `require()` de dentro de um módulo CJS e um `import` de
 * um módulo ESM resolvem instâncias diferentes (é o que acontece sob
 * vitest, e sob qualquer bundler que faça interop). Duas instâncias
 * significam dois barramentos: quem emite não é quem o painel escuta, e
 * o /live fica em branco sem nenhum erro aparecer.
 *
 * Symbol.for garante um único estado por processo, venha o require de
 * onde vier.
 */
const STATE_KEY = Symbol.for('sdr-next.motor.events');

function getState() {
  if (!globalThis[STATE_KEY]) {
    // Um EventEmitter com N assinantes = N abas do painel abertas. O
    // default do Node (10) dispararia warning de leak com o Rael e mais
    // alguém olhando ao mesmo tempo em duas abas.
    const bus = new EventEmitter();
    bus.setMaxListeners(50);
    globalThis[STATE_KEY] = { bus, ring: [], seq: 0 };
  }
  return globalThis[STATE_KEY];
}

/**
 * Tipos usados hoje. Não é enum validado — um tipo novo não deve quebrar
 * o motor —, mas manter a lista aqui evita que cada arquivo invente o
 * seu e o painel fique sem saber o que renderizar.
 */
const EVENT_TYPES = Object.freeze({
  OUTBOUND_SENT: 'outbound_sent',
  INBOUND_RECEIVED: 'inbound_received',
  SEND_ERROR: 'send_error',
  QUOTA_BLOCKED: 'quota_blocked',
  CAMPAIGN_STARTED: 'campaign_started',
  CAMPAIGN_PAUSED: 'campaign_paused',
  CAMPAIGN_DONE: 'campaign_done',
  CAMPAIGN_TICK: 'campaign_tick',
  KILL_SWITCH: 'kill_switch',
});

/**
 * Publica um evento. Nunca lança: telemetria não pode ser o motivo de um
 * envio falhar. Quem chama está sempre no meio do caminho crítico.
 */
function emitEvent(type, payload = {}) {
  const state = getState();
  const event = {
    seq: ++state.seq,
    type,
    at: new Date().toISOString(),
    ...payload,
  };
  try {
    state.ring.push(event);
    if (state.ring.length > RING_SIZE) {
      state.ring.splice(0, state.ring.length - RING_SIZE);
    }
    state.bus.emit('event', event);
  } catch {
    // Silêncio proposital — ver docstring.
  }
  return event;
}

/** Últimos eventos, mais antigos primeiro. Para o replay inicial do SSE. */
function recentEvents(limit = 50) {
  return getState().ring.slice(-Math.max(0, limit));
}

/** Assina o barramento. Devolve a função de cancelamento. */
function subscribe(listener) {
  const { bus } = getState();
  bus.on('event', listener);
  return () => bus.off('event', listener);
}

/** Só para teste — zera ring e sequência. */
function __reset() {
  const state = getState();
  state.ring.length = 0;
  state.seq = 0;
  state.bus.removeAllListeners('event');
}

module.exports = { emitEvent, recentEvents, subscribe, EVENT_TYPES, RING_SIZE, __reset };
