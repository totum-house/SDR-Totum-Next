/**
 * test-manus.js — smoke test do manus_client.js.
 *
 * Uso:
 *   MANUS_URL=http://127.0.0.1:8000 MANUS_TOKEN=xxx \
 *     node apps/motor/scripts/test-manus.js "Retorne 'pong' em JSON"
 *
 * Não executado automaticamente — depende de Manus rodando.
 * Documentado em docs/MANUS_API.md como validação inicial.
 */

const { callManus } = require('../src/manus_client');

async function main() {
  const objective = process.argv[2] || 'Retorne o texto "pong" em JSON';
  const timeout_ms = Number(process.argv[3] || 30000);

  console.log(`[test-manus] URL=${process.env.MANUS_URL || 'http://127.0.0.1:8000'}`);
  console.log(`[test-manus] objective="${objective}"`);
  console.log(`[test-manus] timeout_ms=${timeout_ms}`);
  console.log('---');

  const started = Date.now();
  try {
    const result = await callManus({
      objective,
      context: { __smoke_test: true, ts: new Date().toISOString() },
      timeout_ms,
    });
    const elapsed = Date.now() - started;
    console.log(`[test-manus] OK em ${elapsed}ms`);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    const elapsed = Date.now() - started;
    console.error(`[test-manus] FAIL em ${elapsed}ms`);
    console.error(err.message);
    if (err.response) {
      console.error('response status:', err.response.status);
      console.error('response body:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
