/**
 * server_auth.test.js — cobre a comparação em tempo constante do token
 * do webhook (isAuthorized), incluindo os casos de borda que o
 * timingSafeEqual exige tratar antes (tamanhos diferentes, token vazio).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../src/server.js';

const { isAuthorized } = app;

describe('isAuthorized', () => {
  it('aceita o header exato', () => {
    expect(isAuthorized('Bearer s3cr3t', 's3cr3t')).toBe(true);
  });

  it('rejeita token errado do mesmo tamanho', () => {
    expect(isAuthorized('Bearer s3cr3T', 's3cr3t')).toBe(false);
  });

  it('rejeita header de tamanho diferente sem estourar timingSafeEqual', () => {
    expect(isAuthorized('Bearer s3cr3t-a-mais', 's3cr3t')).toBe(false);
    expect(isAuthorized('Bearer s3c', 's3cr3t')).toBe(false);
  });

  it('rejeita quando o token do servidor não está configurado', () => {
    expect(isAuthorized('Bearer qualquer', '')).toBe(false);
    expect(isAuthorized('Bearer qualquer', undefined)).toBe(false);
  });

  it('rejeita header ausente', () => {
    expect(isAuthorized(undefined, 's3cr3t')).toBe(false);
    expect(isAuthorized('', 's3cr3t')).toBe(false);
  });

  it('rejeita header sem o prefixo Bearer', () => {
    expect(isAuthorized('s3cr3t', 's3cr3t')).toBe(false);
  });
});

describe('MOTOR_EXTRA_BIND', () => {
  it('recusa 0.0.0.0 — nunca bindar em todas as interfaces', async () => {
    vi.resetModules();
    process.env.MOTOR_EXTRA_BIND = '0.0.0.0';
    await expect(import('../src/server.js')).rejects.toThrow(/0\.0\.0\.0/);
    delete process.env.MOTOR_EXTRA_BIND;
    vi.resetModules();
  });

  it('aceita um endereço de bridge Docker normalmente (não lança)', async () => {
    vi.resetModules();
    process.env.MOTOR_EXTRA_BIND = '10.0.16.1';
    const mod = await import('../src/server.js');
    expect(mod.default).toBeDefined();
    delete process.env.MOTOR_EXTRA_BIND;
    vi.resetModules();
  });
});
