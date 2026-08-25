# SDR-Next

SDR autônomo Totum — unificação de 4 sistemas antes separados (SDR-Totum-engine, OpenWA, Manus AI, Next.js frontend) em um produto único.

## Arquitetura (visão de 1 tela)

```
Frontend (Vercel)               →  https://sdr.grupototum.com
  Next.js 15 App Router + Red Theme
  /            operação do dia (leads, campanhas, cota, gateway)
  /leads       base + import CSV
  /campanhas   criar, iniciar, pausar, acompanhar fila
  /builder     editor visual do graph do flow
  /live        feed SSE em tempo real
  /config      regras globais (kill switch, cota, janela, ritmo)

API Routes (Vercel)
  /api/webhook/openwa           ← evento inbound WhatsApp
  /api/leads/import             ← CSV → totum_sdr.leads
  /api/campaigns                → cria campanha + popula a fila
  /api/campaigns/:id            → start/pause (proxy pro motor)
  /api/flows[/:id]              → builder salva o graph
  /api/config                   → lê/grava regras
  /api/live/stream              → proxy do SSE do motor

Motor SDR (VPS · PM2 · Node CJS)
  bind 127.0.0.1:3100
  server.js + flow_runner.js + campaign_runner.js + rules.js
  + llm_provider.js + manus_client.js + events.js

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
│   ├── db/        Migrations SQL do schema totum_sdr
│   └── config/    rules.yaml — regras globais versionadas
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PROTOCOL_CAMADAS.md
│   └── DEPLOYMENT.md
├── .env.example
├── .gitignore
├── pnpm-workspace.yaml
└── README.md
```

## Como o volume de envio é limitado

Quatro camadas, combinadas **sempre pelo menor valor** quando o assunto é
cota, e **por OU** quando o assunto é parar:

| # | Camada | Onde |
|---|---|---|
| 1 | hard cap do código | `apps/motor/src/rules.js` (`HARD_DAILY_CEILING`) |
| 2 | env do deploy | `WARMUP_DAILY_LIMIT`, `WARMUP_ENABLED` |
| 3 | arquivo versionado | `packages/config/rules.yaml` |
| 4 | banco (UI `/config`) | `totum_sdr.rules` |

Nem o YAML nem a UI conseguem **aumentar** o teto — só abaixar. Qualquer
uma consegue **ligar** o kill switch, nenhuma consegue desligar a das
outras. Isso não é excesso de zelo: em 2026-08-24 saíram 10 mensagens com
o limite configurado em 2, porque a trava morava num lugar só.

O kill switch para tudo em menos de 30s de verdade — inclusive no meio de
uma espera de 120s entre mensagens (`sleepUnlessKilled`).

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

# Testes (134 no total: 113 no motor, 21 no painel)
cd apps/motor && pnpm test
cd apps/web   && pnpm test

# OpenWA — instância real fica em /opt/OpenWA no VPS (repo próprio deles,
# clonado direto lá). Não há compose neste monorepo. Ver apps/openwa/README.md
```

Portas locais:
- `127.0.0.1:2785` — OpenWA (no VPS; local só se você clonar o repo deles)
- `127.0.0.1:3100` — Motor SDR (PM2/node)
- `127.0.0.1:3200` — Frontend Next dev (`pnpm dev`)

## Smoke test end-to-end

Roteiro completo em [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) — inclui
uma versão em modo mock que valida o sistema inteiro sem gastar cota do
número em warm-up.

## Deploy produção

Ver [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Autores

- Rael/Israel — decisões de produto, produção, warm-up WhatsApp
- Kleber B (agente) — implementação, spec, docs
