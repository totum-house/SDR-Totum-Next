/**
 * test-llm.js — smoke test do llm_provider chain (gemini → groq → nvidia).
 *
 * Uso:
 *   GEMINI_API_KEY=... GROQ_API_KEY=... NVIDIA_API_KEY=... \
 *     node apps/motor/scripts/test-llm.js "Diga oi em 3 palavras"
 *
 * Skip automático de provider sem chave — testa o fallback real.
 */

const { generate } = require('../src/llm_provider');

async function main() {
  const prompt = process.argv[2] || 'Responda apenas: pong';

  console.log('[test-llm] chain: gemini → groq → nvidia');
  console.log(`[test-llm] prompt="${prompt}"`);
  console.log('---');

  const started = Date.now();
  try {
    const reply = await generate(prompt);
    const elapsed = Date.now() - started;
    console.log(`[test-llm] OK em ${elapsed}ms`);
    console.log('---');
    console.log(reply);
    process.exit(0);
  } catch (err) {
    console.error('[test-llm] FAIL:', err.message);
    process.exit(1);
  }
}

main();
