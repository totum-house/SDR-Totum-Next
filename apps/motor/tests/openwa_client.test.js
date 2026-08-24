/**
 * openwa_client.test.js — cobre o client contra o contrato VERIFICADO em
 * 2026-08-24 (Swagger real de rmyndharis/OpenWA): rota escopada por sessão,
 * header X-API-Key, chatId com sufixo @c.us.
 *
 * Usa __setHttpClientForTests em vez de vi.mock('axios'): o client usa
 * require('axios') (CJS) internamente, e esse require resolve uma instância
 * de módulo diferente da que o `import axios` deste arquivo (ESM) enxerga —
 * vi.mock/spyOn não intercepta de forma confiável nesse caso. A seam de
 * injeção é o mesmo padrão já usado em flow_runner.js (createRunner com
 * llmGenerate/manusClient injetados).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const postMock = vi.fn();
const getMock = vi.fn();

async function freshClient() {
  vi.resetModules();
  const mod = await import('../src/openwa_client.js');
  mod.__setHttpClientForTests({ post: postMock, get: getMock });
  return mod;
}

describe('openwa_client', () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    process.env.OPENWA_URL = 'http://127.0.0.1:2785';
    process.env.OPENWA_API_KEY = 'test-key';
    process.env.OPENWA_SESSION_ID = 'sdr-totum';
  });

  it('sendMessage bate na rota escopada por sessão com chatId @c.us', async () => {
    postMock.mockResolvedValue({ data: { id: 'msg-1' } });
    const { sendMessage } = await freshClient();

    const res = await sendMessage('5511999999999', 'oi');

    expect(postMock).toHaveBeenCalledWith(
      '/sessions/sdr-totum/messages/send-text',
      { chatId: '5511999999999@c.us', text: 'oi' }
    );
    expect(res).toEqual({ id: 'msg-1' });
  });

  it('sendMessage preserva chatId já formatado (grupo @g.us)', async () => {
    postMock.mockResolvedValue({ data: {} });
    const { sendMessage } = await freshClient();

    await sendMessage('12345@g.us', 'oi grupo');

    expect(postMock).toHaveBeenCalledWith(
      '/sessions/sdr-totum/messages/send-text',
      { chatId: '12345@g.us', text: 'oi grupo' }
    );
  });

  it('sendMessage trunca no limite do contrato (4096)', async () => {
    postMock.mockResolvedValue({ data: {} });
    const { sendMessage, MAX_TEXT_LEN } = await freshClient();

    await sendMessage('5511999999999', 'x'.repeat(5000));

    expect(postMock.mock.calls[0][1].text).toHaveLength(MAX_TEXT_LEN);
  });

  it('sem OPENWA_SESSION_ID: lança erro claro em vez de bater na API', async () => {
    delete process.env.OPENWA_SESSION_ID;
    const { sendMessage } = await freshClient();

    await expect(sendMessage('5511999999999', 'oi')).rejects.toThrow(/OPENWA_SESSION_ID/);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('checkNumber consulta /contacts/check/{number} e interpreta o resultado', async () => {
    getMock.mockResolvedValue({ data: { exists: true } });
    const { checkNumber } = await freshClient();

    const exists = await checkNumber('5511999999999');

    expect(getMock).toHaveBeenCalledWith('/sessions/sdr-totum/contacts/check/5511999999999');
    expect(exists).toBe(true);
  });

  it('checkNumber engole erro de rede e retorna null (não sei, não bloqueia)', async () => {
    getMock.mockRejectedValue(new Error('timeout'));
    const { checkNumber } = await freshClient();

    await expect(checkNumber('5511999999999')).resolves.toBe(null);
  });

  it('setTyping nunca lança — é cosmético', async () => {
    postMock.mockRejectedValue(new Error('boom'));
    const { setTyping } = await freshClient();

    await expect(setTyping('5511999999999', true)).resolves.toBe(false);
  });

  it('toChatId rejeita telefone sem nenhum dígito', async () => {
    const { toChatId } = await freshClient();
    expect(() => toChatId('abc')).toThrow(/inválido/);
  });
});
