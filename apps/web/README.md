# apps/web — Frontend SDR-Next

Next.js 15 App Router + React 19 + Tailwind 3 + Red Theme.

## Rotas

| Path                       | Descrição                                            |
|----------------------------|------------------------------------------------------|
| `/`                        | Redirect → `/console`                                |
| `/console`                 | Conversas em tempo real (SSE stream — próxima fase)  |
| `/flows`                   | Lista de flows (builder — próxima fase)              |
| `/leads`                   | Base de leads                                        |
| `/settings`                | Hub de configuração                                  |
| `/settings/whatsapp`       | OpenWA session + QR (🔴 QR pede autorização)          |
| `/settings/providers`      | LLM chain gemini→groq→nvidia                         |

## API Routes (proxy pro Motor)

| Path                                        | Método | Alvo                          |
|---------------------------------------------|--------|-------------------------------|
| `/api/health`                               | GET    | `motor 127.0.0.1:3100/health` |
| `/api/webhook/openwa`                       | POST   | `motor /api/webhook/openwa`   |
| `/api/conversations/[id]/stream`            | GET    | SSE stub (Supabase Realtime)  |

## Dev

```bash
pnpm install
pnpm --filter @sdr-next/web dev    # porta 3200
open http://127.0.0.1:3200
```

## Build

```bash
pnpm --filter @sdr-next/web build
pnpm --filter @sdr-next/web start
```

**Não executado nesta fase** — depende de `pnpm install` (network). Documentado no commit `[fase-5]`.

## Deploy

Alvo canônico: Vercel (`vercel.grupototum.com` ou domínio próprio).
🔴 **Pede autorização explícita antes de conectar repositório ao projeto Vercel prod.**

## Tema

`brand-*` = red-600 (#dc2626) inspirado no Totum-OS. Sidebar fixa, dark mode by default.

## Env

Copiar do root `.env.example`:
- `MOTOR_URL=http://127.0.0.1:3100`
- `OPENWA_WEBHOOK_TOKEN=<mesmo do OpenWA>`
- `NEXT_PUBLIC_SUPABASE_URL=https://supa.grupototum.com`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>`
