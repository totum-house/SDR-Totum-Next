/**
 * sse_live.test.js — o stream que alimenta a tela /live.
 *
 * Testa contra um socket de verdade, não só a função: o que quebra SSE
 * na prática é enquadramento (a linha em branco entre eventos), header
 * faltando e conexão que não sobrevive — nada disso aparece testando o
 * handler isolado.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';

const TOKEN = 'token-de-teste';

let server;
let baseUrl;
let events;

beforeAll(async () => {
  // O server.js lê OPENWA_WEBHOOK_TOKEN no import — precisa estar no env
  // antes, e o módulo precisa ser recarregado.
  process.env.OPENWA_WEBHOOK_TOKEN = TOKEN;
  delete process.env.MOTOR_EXTRA_BIND;
  vi.resetModules();

  const mod = await import('../src/server.js');
  events = await import('../src/events.js');

  server = http.createServer(mod.default);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Abre o SSE e devolve o que chegou até `until` bater (ou o timeout). */
function readStream(headers, { until, timeoutMs = 2000 }) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}/sse/live`, { headers }, (res) => {
      let buffer = '';
      const finish = () => {
        clearTimeout(timer);
        req.destroy();
        resolve({ status: res.statusCode, headers: res.headers, body: buffer });
      };
      const timer = setTimeout(finish, timeoutMs);

      if (res.statusCode !== 200) {
        res.on('data', (c) => { buffer += c; });
        res.on('end', finish);
        return;
      }
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        if (until(buffer)) finish();
      });
    });
    req.on('error', reject);
  });
}

describe('GET /sse/live', () => {
  it('recusa sem token — o painel fala por um proxy que guarda o segredo', async () => {
    const out = await readStream({}, { until: () => true, timeoutMs: 1000 });
    expect(out.status).toBe(401);
  });

  it('manda os headers que impedem o proxy de bufferizar o stream', async () => {
    const out = await readStream(
      { Authorization: `Bearer ${TOKEN}` },
      { until: (b) => b.includes('conectado'), timeoutMs: 1500 }
    );
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toContain('text/event-stream');
    expect(out.headers['cache-control']).toContain('no-transform');
    // Sem isto o nginx segura os eventos e o "tempo real" chega em blocos.
    expect(out.headers['x-accel-buffering']).toBe('no');
  });

  it('entrega evento emitido pelo motor, enquadrado como SSE', async () => {
    events.__reset();

    const pending = readStream(
      { Authorization: `Bearer ${TOKEN}` },
      { until: (b) => b.includes('outbound_sent'), timeoutMs: 2000 }
    );

    // Emite depois da conexão abrir — é o caminho real (o evento nasce
    // durante o disparo, com o painel já aberto).
    await new Promise((r) => setTimeout(r, 150));
    events.emitEvent(events.EVENT_TYPES.OUTBOUND_SENT, {
      phone: '5531999998888',
      content: 'Oi, tudo bem?',
    });

    const out = await pending;

    expect(out.body).toContain('event: outbound_sent');
    expect(out.body).toContain('"content":"Oi, tudo bem?"');
    // A linha em branco é o que separa um evento do outro no protocolo —
    // sem ela o browser nunca entrega nada ao listener.
    expect(out.body).toMatch(/data: .+\n\n/);
    // id: permite o browser retomar de onde parou depois de reconectar.
    expect(out.body).toMatch(/id: \d+/);
  });

  it('faz replay do que já aconteceu para quem acabou de abrir a tela', async () => {
    events.__reset();
    events.emitEvent(events.EVENT_TYPES.CAMPAIGN_STARTED, { name: 'Campanha antiga' });

    const out = await readStream(
      { Authorization: `Bearer ${TOKEN}` },
      { until: (b) => b.includes('Campanha antiga'), timeoutMs: 2000 }
    );

    // Em warm-up a tela pode ficar horas sem evento novo; abrir e não ver
    // nada do que já aconteceu parece "não está funcionando".
    expect(out.body).toContain('event: campaign_started');
    expect(out.body).toContain('Campanha antiga');
  });
});
