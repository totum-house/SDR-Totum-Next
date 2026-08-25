/**
 * motor.ts — client HTTP para o Motor SDR (127.0.0.1:3100).
 *
 * Usado apenas em Route Handlers e Server Components. Nunca chamar do
 * client. D-017: sempre 127.0.0.1, nunca localhost.
 *
 * AUTENTICAÇÃO: o motor valida `Authorization: Bearer <OPENWA_WEBHOOK_TOKEN>`
 * em todos os endpoints, não só no webhook (ver apps/motor/src/server.js).
 * É o mesmo segredo servindo de token de administração — vale trocar por
 * um par de tokens separados quando houver mais de um consumidor do motor,
 * mas hoje o painel é o único, e inventar um segundo segredo agora só
 * criaria mais uma coisa para sincronizar entre .env e VPS.
 */

const MOTOR_URL = process.env.MOTOR_URL || 'http://127.0.0.1:3100';

export function motorAuthHeader(): Record<string, string> {
  const token = process.env.OPENWA_WEBHOOK_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function motorFetch(path: string, init: RequestInit = {}) {
  const url = `${MOTOR_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...motorAuthHeader(),
      ...(init.headers || {}),
    },
    // Motor é LAN interna, sem cache
    cache: 'no-store',
  });
  return res;
}

export function motorUrl(path: string) {
  return `${MOTOR_URL}${path}`;
}

export type MotorStatus = {
  configured: boolean;
  kill_switch?: boolean;
  mock_send?: boolean;
  campaign_loop?: boolean;
  quota?: { used: number; limit: number; remaining: number };
  window?: { allowed: boolean; reason: string | null };
  campaign?: { id: string; name: string; status: string } | null;
  rules?: Record<string, unknown>;
};

/**
 * Status do motor para o dashboard. Motor fora do ar é informação, não
 * exceção: a página precisa conseguir dizer "motor offline" em vez de
 * devolver 500 e não mostrar nada do resto.
 */
export async function fetchMotorStatus(): Promise<MotorStatus & { online: boolean }> {
  try {
    const res = await motorFetch('/api/status');
    if (!res.ok) return { online: false, configured: false };
    const data = (await res.json()) as MotorStatus;
    return { online: true, ...data };
  } catch {
    return { online: false, configured: false };
  }
}
