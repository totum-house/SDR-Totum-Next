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
│  /api/leads/import              → CSV upload                    │
│  /api/campaigns/:id/dispatch    → dispara warm-up               │
└───────────────┬─────────────────────────────────────────────────┘
                │
                │ HTTP (via Traefik → 127.0.0.1)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  MOTOR SDR (VPS 2.24.206.161 · PM2 · Node CJS)                  │
│  bind 127.0.0.1:3100                                            │
│  ├─ brain.js (port do SDR-Totum-engine)                         │
│  ├─ flow_runner (executa flow definido em Supabase)             │
│  ├─ manus_client (delegação de tasks pesadas)                   │
│  └─ llm_router (gemini → groq → nvidia fallback)                │
└───────┬─────────────────────────────────────────────┬───────────┘
        │                                             │
        │ HTTP                                        │ HTTP
        ▼                                             ▼
┌─────────────────────────┐          ┌──────────────────────────┐
│  OPENWA (Docker)        │          │  MANUS (já rodando)      │
│  bind 127.0.0.1:3000    │          │  bind 127.0.0.1:8000     │
│  Traefik expõe:         │          │  manus.grupototum.com    │
│  openwa.grupototum.com  │          │                          │
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
                    │  Tabelas (001_bootstrap):       │
                    │  ├─ workspaces                 │
                    │  ├─ leads                      │
                    │  ├─ conversations              │
                    │  ├─ messages                   │
                    │  ├─ flows                      │
                    │  ├─ flow_runs                  │
                    │  ├─ automations                │
                    │  └─ automation_runs             │
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
- Runtime: Node.js CJS (compatibilidade com brain.js legado)
- Process manager: PM2
- Bind: `127.0.0.1:3100` (nunca exposto público)
- Reverse proxy: Traefik → `motor.grupototum.com` (interno)
- Responsabilidades:
  - `brain.js`: máquina de estados do lead (idle → contactado → qualificando → qualified/lost)
  - `flow_runner`: executa steps definidos no Supabase (message, wait, condition, `improvise_with_goal`)
  - `manus_client`: delega tasks pesadas (research, resumo longo) para Manus
  - `llm_router`: chain gemini → groq → nvidia com timeout+retry

### OpenWA (`apps/openwa`)
- Versão: v0.23.1 (Docker image `openwa/wa-automate`)
- Bind: `127.0.0.1:3000`
- Traefik: `openwa.grupototum.com` (acesso restrito por IP allowlist + token)
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
- RLS: definido em fase 4, aprovação Rael obrigatória

## Fluxo end-to-end (happy path)

1. Rael sobe CSV de leads via console → `/api/leads/import`
2. Rael dispara campanha → `/api/campaigns/:id/dispatch`
3. Motor SDR pega leads, respeita warm-up schedule, chama OpenWA
4. OpenWA envia via WhatsApp → lead recebe
5. Lead responde → OpenWA webhook → `/api/webhook/openwa` → Motor SDR
6. `brain.js` roda transição de estado, `flow_runner` executa próximo step
7. Se step é `improvise_with_goal`, LLM router escolhe provider e responde
8. Resposta volta pro OpenWA → lead
9. Console (SSE) mostra tudo em tempo real
10. Lead qualificado → notifica Rael via Telegram (fase 6)

## Portas & binds

| Serviço      | Bind             | Exposição pública           |
|--------------|------------------|-----------------------------|
| Frontend     | Vercel           | `sdr.grupototum.com`        |
| Motor SDR    | `127.0.0.1:3100` | Nenhuma (só Traefik interno)|
| OpenWA       | `127.0.0.1:3000` | `openwa.grupototum.com` restrito |
| Manus        | `127.0.0.1:8000` | `manus.grupototum.com`      |
| Supabase     | Docker network   | `supa.grupototum.com`       |

**Regra:** nenhum serviço Node/Python usa `localhost` — sempre `127.0.0.1` (D-017).

## Decisões arquiteturais relevantes

- **Monorepo pnpm** — apps + packages compartilham types via `packages/shared`
- **CJS no Motor** — brain.js legado é CJS; migração pra ESM adiada
- **Supabase self-hosted** — evita quota Cloud, permite schema dedicado
- **VoIP DID com histórico** — Rael aceita risco de ban por ter histórico legítimo
- **Chain de LLM** — gemini primeiro (cota grátis), groq fallback (rápido), nvidia último (caro)

## Referências

- SPEC completo: `SPEC-SDR-NEXT-MVP.md` (workspace root)
- Protocolo de camadas: `docs/PROTOCOL_CAMADAS.md`
- Deploy: `docs/DEPLOYMENT.md`
