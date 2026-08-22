/**
 * motor.ts — client HTTP para o Motor SDR (127.0.0.1:3100).
 *
 * Usado apenas em Route Handlers (server-side). Nunca chamar do client.
 * D-017: sempre 127.0.0.1, nunca localhost.
 */

const MOTOR_URL = process.env.MOTOR_URL || 'http://127.0.0.1:3100';

export async function motorFetch(path: string, init: RequestInit = {}) {
  const url = `${MOTOR_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    // Motor é LAN interna, sem cache
    cache: 'no-store',
  });
  return res;
}
