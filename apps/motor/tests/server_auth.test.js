/**
 * server_auth.test.js — cobre a comparação em tempo constante do token
 * do webhook (isAuthorized), incluindo os casos de borda que o
 * timingSafeEqual exige tratar antes (tamanhos diferentes, token vazio).
 */

import { describe, it, expect } from 'vitest';
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
