# SDR-Next — Protocolo de Camadas

Aplicação do [protocolo de camadas Totum](../../memory/protocolo-camadas-totum.md) ao SDR-Next.

**Modo:** projeto novo (aplicando `protocolo-camadas-zero.md`, não `adequacao.md`).

## Mapeamento arquivo → camada

Cada arquivo pertence a **1 camada única**. Antes de editar, identifique a camada e verifique se a mudança está autorizada pela matriz de autonomia.

### L1 · UI pura (🟢 verde — autonomia livre)
- `apps/web/app/**/page.tsx`
- `apps/web/app/**/layout.tsx`
- `apps/web/components/ui/**/*.tsx`
- `apps/web/styles/**/*.css`

### L2 · State frontend (🟡 amarelo — informa antes)
- `apps/web/lib/store/*.ts`
- `apps/web/hooks/*.ts`

### L3 · API Routes (🟡 amarelo — informa antes)
- `apps/web/app/api/**/route.ts`

### L4 · Motor SDR runtime (🟡 amarelo — informa antes)
- `apps/motor/src/**/*.js` (CJS)
- `apps/motor/ecosystem.config.js` (PM2)

### L5 · Integração externa non-critical (🟡 amarelo)
- `apps/motor/src/manus_client.js`
- `apps/motor/src/llm_provider.js`

### L6 · Integração externa CRITICAL (🟠 laranja — pede aprovação)
- `apps/openwa/docker-compose.yml`
- `apps/openwa/config/*`
- Qualquer mudança que altere comportamento de envio WhatsApp

### L7 · Schema banco (🟠 laranja — pede aprovação)
- `packages/db/migrations/*.sql`

### L8 · RLS / Auth / Storage (🔴 vermelho — NUNCA sozinho)
- Policies RLS em `packages/db/policies/*.sql`
- Config Supabase Auth
- Buckets Storage

### L9 · Env / secrets (🔴 vermelho — NUNCA sozinho)
- `.env`, `.env.local`, `.env.production` (nunca commit)
- Vars no Vercel dashboard
- Vars no `/opt/sdr-next/.env` na VPS

### L10 · DNS / Traefik / Coolify (🔴 vermelho — NUNCA sozinho)
- Configuração de domínio
- Regras Traefik
- Configuração Coolify

### L11 · Warm-up WhatsApp (🔴 vermelho — decisão do Rael)
- `packages/db/seed/warmup_schedule.sql`
- Qualquer alteração no schedule dia 1-90

### L12 · Testes (🟢 verde)
- `apps/*/tests/**/*.test.ts`
- `apps/*/tests/**/*.spec.js`

### L13 · Docs (🟢 verde)
- `README.md`
- `docs/**/*.md`
- `SPEC-*.md`

## Sub-camadas de banco (dentro de L7)

| Sub | Arquivo padrão                              | Autonomia            |
|-----|---------------------------------------------|----------------------|
| L7a | `packages/db/migrations/NNN_*.sql`          | 🟠 laranja           |
| L7b | `packages/db/seed/*.sql` (dados operacionais)| 🟠 laranja          |
| L7c | `packages/db/seed/dev_*.sql` (dados dev)    | 🟡 amarelo           |
| L7d | `packages/db/functions/*.sql` (RPCs)        | 🟠 laranja           |
| L7e | `packages/db/triggers/*.sql`                | 🔴 vermelho          |
| L7f | `packages/db/policies/*.sql` (RLS)          | 🔴 vermelho          |
| L7g | `packages/db/views/*.sql`                   | 🟡 amarelo           |

## Regras de aplicação

1. **Toque duplo:** se PR toca 2+ camadas, escala pra camada mais alta
2. **Migration nunca no automático:** SQL só roda em prod após "aprovado, aplica em prod" literal
3. **Verify por camada:** teste correspondente obrigatório antes de merge
4. **Rollback declarado:** cada PR de L6+ tem instrução de rollback no corpo

## Referências

- Protocolo completo: `memory/protocolo-camadas-totum.md`
- Matriz de autonomia: `SPEC-SDR-NEXT-MVP.md` §5
