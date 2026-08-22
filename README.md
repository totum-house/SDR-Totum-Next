# SDR-Next

SDR autônomo Totum — unificação de 4 sistemas antes separados (SDR-Totum-engine, OpenWA, Manus AI, Next.js frontend) em um produto único.

## Arquitetura (visão de 1 tela)

```
Frontend (Vercel)               →  https://sdr.grupototum.com
  Next.js 15 App Router + Red Theme

API Routes (Vercel)
  /api/webhook/openwa           ← evento inbound WhatsApp
  /api/conversations/:id/stream  → SSE pra console

Motor SDR (VPS · PM2 · Node CJS)
  bind 127.0.0.1:3100
  brain.js portado + flow_runner + manus_client

Gateway WhatsApp (VPS · Docker)
  OpenWA v0.23.1
  bind 127.0.0.1:3000  → Traefik expõe openwa.grupototum.com

Manus (VPS · já rodando)
  bind 127.0.0.1:8000  → manus.grupototum.com

Database
  Supabase self-hosted supa.grupototum.com
  schema `totum_sdr` (bootstrap: packages/db/migrations/001_bootstrap_totum_sdr.sql)
```

Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Estrutura do monorepo

```
sdr-next/
├── apps/
│   ├── web/       Next.js 15 App Router (frontend + API Routes)
│   ├── motor/     Motor SDR Node CJS, PM2
│   └── openwa/    docker-compose OpenWA
├── packages/
│   ├── db/        Supabase client + migrations SQL
│   └── shared/    Types TS compartilhados
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PROTOCOL_CAMADAS.md
│   └── DEPLOYMENT.md
├── .env.example
├── .gitignore
├── pnpm-workspace.yaml
└── README.md
```

## Regras de ouro (não negociáveis)

- Sempre `127.0.0.1`, nunca `localhost` em config Node/Python
- Cookie SSO `.grupototum.com` em qualquer auth/redirect
- Nunca commitar `.env`, service_role, JWT, token real
- Backup obrigatório antes de qualquer mutação em prod (dump + sha256 + timestamp)
- 1 correção = 1 commit local, prefixo `[fase-N-lote-X]`
- Verify fail (build ou test) = revert imediato + report
- Nenhuma migration em prod sem "aprovado, aplica em prod" literal do Rael

## Como rodar dev local (rápido)

```bash
pnpm install
cp .env.example .env.local
# preenche secrets em .env.local (nunca commit)

# Frontend
cd apps/web && pnpm dev

# Motor SDR
cd apps/motor && pnpm dev

# OpenWA (Docker)
cd apps/openwa && docker compose up -d
```

Portas locais:
- `127.0.0.1:3000` — OpenWA (Docker)
- `127.0.0.1:3100` — Motor SDR (PM2/node)
- `127.0.0.1:3200` — Frontend Next dev (`pnpm dev`)

## Deploy produção

Ver [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Autores

- Rael/Israel — decisões de produto, produção, warm-up WhatsApp
- Kleber B (agente) — implementação, spec, docs
