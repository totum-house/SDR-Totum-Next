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
  server.js + flow_runner.js + llm_provider.js + manus_client.js

Gateway WhatsApp (VPS · Docker)
  rmyndharis/OpenWA — API REST com Swagger, escopada por sessão
  bind 127.0.0.1:2785  → acesso hoje via túnel SSH (não exposto)

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
│   └── db/        Migrations SQL do schema totum_sdr
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

# OpenWA — instância real fica em /opt/OpenWA no VPS (repo próprio deles,
# clonado direto lá). Não há compose neste monorepo. Ver apps/openwa/README.md
```

Portas locais:
- `127.0.0.1:2785` — OpenWA (no VPS; local só se você clonar o repo deles)
- `127.0.0.1:3100` — Motor SDR (PM2/node)
- `127.0.0.1:3200` — Frontend Next dev (`pnpm dev`)

## Deploy produção

Ver [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Autores

- Rael/Israel — decisões de produto, produção, warm-up WhatsApp
- Kleber B (agente) — implementação, spec, docs
