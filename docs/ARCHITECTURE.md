# SDR-Next — Arquitetura

## Visão de 1 tela

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (Vercel)                                              │
│  https://sdr.grupototum.com                                     │
│  Next.js 15 App Router · Tailwind · Red Theme                   │
│  Auth: cookie SSO .grupototum.com (Supabase self-hosted)        │
└───────────────┬─────────────────────────────────────────────────┘
                │
                │ HTTPS
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  API ROUTES (Vercel, mesma origem)                              │
│  /api/webhook/openwa            ← evento inbound WhatsApp       │
│  /api/conversations/:id/stream  → SSE pra console               │
│  /api/leads/import              → CSV upload (501, não impl.)   │
│  /api/campaigns/:id/dispatch    → warm-up (501, não impl.)      │
└───────────────┬─────────────────────────────────────────────────┘
                │
                │ HTTP (via Traefik → 127.0.0.1)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  MOTOR SDR (VPS 2.24.206.161 · PM2 · Node CJS)                  │
│  bind 127.0.0.1:3100                                            │
│  ├─ server.js (HTTP + auth do webhook + dispatch)               │
│  ├─ webhook_handler.js (lead/conversation + persistência)       │
│  ├─ flow_runner.js (executa o graph do flow)                    │
│  ├─ llm_provider.js (gemini → groq → nvidia + retry + breaker)  │
│  ├─ manus_client.js (delegação de tasks pesadas)                │
│  └─ openwa_client.js (envio de mensagem)                        │
└───────┬─────────────────────────────────────────────┬───────────┘
        │                                             │
        │ HTTP                                        │ HTTP
        ▼                                             ▼
┌─────────────────────────┐          ┌──────────────────────────┐
│  OPENWA (Docker)        │          │  MANUS (já rodando)      │
│  bind 127.0.0.1:3000    │          │  bind 127.0.0.1:8000     │
│  Traefik expõe:         │          │  manus.grupototum.com    │
│  zap.grupototum.com     │          │                          │
│  Número: VoIP 3131577292│          │  Executor auxiliar       │
└─────────────────────────┘          └──────────────────────────┘
        │
        │ WhatsApp Web protocol
        ▼
   [WhatsApp Cloud]
        │
        ▼
    Lead final

                    ┌────────────────────────────────┐
                    │  DATABASE                      │
                    │  Supabase self-hosted          │
                    │  supa.grupototum.com           │
                    │  Schema: totum_sdr             │
                    │                                │
                    │  Tabelas (001_bootstrap):      │
                    │  ├─ workspaces                 │
                    │  ├─ leads                      │
                    │  ├─ conversations              │
                    │  ├─ messages                   │
                    │  ├─ flows                      │
                    │  ├─ flow_runs                  │
                    │  ├─ automations                │
                    │  └─ automation_runs            │
                    └────────────────────────────────┘
```

## Componentes

### Frontend (`apps/web`)
- Next.js 15 App Router
- Deploy: Vercel (projeto próprio)
- Domínio: `sdr.grupototum.com`
- Tema: Red Totum (design system compartilhado)
- Auth: cookie SSO `.grupototum.com` — usuário logado em qualquer sistema Totum já entra
- Console em tempo real: SSE em `/api/conversations/:id/stream`

### API Routes (`apps/web/app/api`)
- Mesma origem do frontend (Vercel edge/serverless)
- Webhook OpenWA: valida token, roteia para Motor SDR
- SSE proxy: lê Supabase Realtime, empurra pro browser
- CSV upload: parse + insert `leads`
- Dispatch: aciona Motor SDR pra iniciar campanha

### Motor SDR (`apps/motor`)
- Runtime: Node.js CJS
- Process manager: PM2
- Bind: `127.0.0.1:3100` (nunca exposto público)
- Reverse proxy: Traefik → `motor.grupototum.com` (interno)
- Responsabilidades:
  - `server.js`: HTTP, valida token do webhook em tempo constante, rota de dispatch
  - `webhook_handler.js`: acha/cria lead + conversation, persiste mensagens, orquestra o step
  - `flow_runner.js`: executa o graph (message, question, condition, `improvise_with_goal`, `call_manus`, `end`)
  - `llm_provider.js`: chain gemini → groq → nvidia, com retry em backoff e circuit breaker por provider
  - `manus_client.js`: delega tasks pesadas (research, resumo longo) para Manus
  - `openwa_client.js`: envia a mensagem de volta pro lead

> Não existe `brain.js` neste repo. A máquina de estados do
> SDR-Totum-engine não foi portada — quem decide o próximo passo hoje é
> o `flow_runner.js` a partir do graph do flow.

### OpenWA (`apps/openwa`)
- Versão: v0.23.1 (Docker image `openwa/wa-automate`)
- Bind: `127.0.0.1:3000`
- Traefik: `zap.grupototum.com` (acesso restrito por IP allowlist + token)
- Sessão persistida em volume Docker `openwa-session`
- Número: VoIP DID 3131577292 (ver [[whatsapp-sdr-voip-3131577292]])

### Manus
- Já rodando na VPS
- Bind: `127.0.0.1:8000` → `manus.grupototum.com`
- Motor SDR chama via HTTP com `MANUS_TOKEN`

### Database
- Supabase self-hosted (`supa.grupototum.com`) — decisão D-020
- Schema dedicado: `totum_sdr`
- Migrations versionadas em `packages/db/migrations/`
- Bootstrap: `001_bootstrap_totum_sdr.sql`
- RLS: habilitada na 001 com policies owner-only (ver `packages/db/README.md`)

## Fluxo end-to-end (happy path)

1. Lead manda mensagem → OpenWA recebe
2. OpenWA dispara webhook → `POST /api/webhook/openwa` no Motor (Bearer token)
3. `webhook_handler` acha/cria o lead e a conversation, grava a mensagem inbound
4. Busca o flow ativo do workspace e chama `flow_runner.step()`
5. Se o nó é `improvise_with_goal`, `llm_provider` escolhe o provider e gera a resposta
6. Resposta passa pelo guardrail (tamanho + limpeza) e é gravada como outbound
7. `openwa_client` envia de volta pro lead via OpenWA
8. Abordagem outbound manual: `POST /api/dispatch/:leadId` roda o mesmo caminho sem inbound

**Não implementado ainda:** import de CSV, campanhas/warm-up automático,
console SSE em tempo real, notificação Telegram.

## Portas & binds

| Serviço      | Bind             | Exposição pública           |
|--------------|------------------|-----------------------------|
| Frontend     | Vercel           | `sdr.grupototum.com`        |
| Motor SDR    | `127.0.0.1:3100` | Nenhuma (só Traefik interno)|
| OpenWA       | `127.0.0.1:3000` | `zap.grupototum.com` restrito |
| Manus        | `127.0.0.1:8000` | `manus.grupototum.com`      |
| Supabase     | Docker network   | `supa.grupototum.com`       |

**Regra:** nenhum serviço Node/Python usa `localhost` — sempre `127.0.0.1` (D-017).

## Decisões arquiteturais relevantes

- **Monorepo pnpm** — `apps/*` + `packages/*` (não existe `packages/shared`; não há types compartilhados hoje)
- **CJS no Motor** — mantido por simplicidade de PM2; migração pra ESM adiada
- **Supabase self-hosted** — evita quota Cloud, permite schema dedicado
- **VoIP DID com histórico** — Rael aceita risco de ban por ter histórico legítimo
- **Chain de LLM** — gemini primeiro (cota grátis), groq fallback (rápido), nvidia último (caro)

## Referências

- SPEC completo: `SPEC-SDR-NEXT-MVP.md` (workspace root)
- Protocolo de camadas: `docs/PROTOCOL_CAMADAS.md`
- Deploy: `docs/DEPLOYMENT.md`
