# SDR-Next — Deployment

> **Status:** stub. Detalhes finais serão preenchidos ao longo das FASES 3, 5 e 7 do SPEC.

## Ambientes

| Ambiente   | Onde                                 | Domínio                     |
|------------|--------------------------------------|-----------------------------|
| Dev local  | Macbook Rael / laptop dev            | `127.0.0.1:3200`            |
| Staging    | (a definir — subdomínio ou preview)  | `sdr-staging.grupototum.com`|
| Produção   | Vercel (frontend) + VPS (motor+wa)   | `sdr.grupototum.com`        |

## Componentes de deploy

### Frontend (`apps/web`) → Vercel
- Projeto Vercel dedicado: `sdr-next`
- Branch → env:
  - `main` → produção
  - `staging` → preview
  - qualquer outra → preview branch
- Env vars: gerenciadas no dashboard Vercel (nunca no repo)
- Domínio custom: `sdr.grupototum.com` via CNAME
- **Autorização:** 🔴 vermelho — deploy prod só com "aplica em prod" literal

### Motor SDR (`apps/motor`) → VPS PM2
- Path: `/opt/sdr-next/motor/`
- Deploy: `git pull && pnpm install --prod && pm2 reload ecosystem.config.js`
- PM2 startup habilitado (sobrevive reboot)
- Logs: `pm2 logs sdr-motor`
- **Autorização:** 🟠 laranja para primeiro deploy; 🟡 amarelo para redeploy

### OpenWA (`apps/openwa`) → Docker na VPS
- Path: `/opt/sdr-next/openwa/`
- Deploy: `docker compose pull && docker compose up -d`
- Volume persistente: `openwa-session` (contém sessão WhatsApp — CRÍTICO)
- Backup do volume: obrigatório antes de qualquer redeploy
- **Autorização:** 🔴 vermelho — envolve número WhatsApp real

### Database → Supabase self-hosted
- URL: `supa.grupototum.com`
- Schema dedicado: `totum_sdr`
- Migrations: rodadas manualmente via psql, uma por vez
- Backup: dump + sha256 + timestamp antes de cada migration
- **Autorização:** 🟠 laranja — migration em prod só com "aprovado, aplica em prod"

## Checklist pré-deploy prod (obrigatório)

- [ ] Build passa local (`pnpm build` no workspace)
- [ ] Testes passam (`pnpm test`)
- [ ] `.env.production` conferido (nenhum placeholder)
- [ ] Backup do banco: `pg_dump ... | tee dump-$(date +%Y%m%d-%H%M%S).sql | sha256sum`
- [ ] Backup do volume OpenWA (se tocar em `apps/openwa`)
- [ ] Rollback plan escrito no PR
- [ ] "aprovado, aplica em prod" literal do Rael no chat

## Rollback

### Frontend
- Vercel dashboard → deployment anterior → "Promote to Production"

### Motor SDR
- `cd /opt/sdr-next && git reset --hard <commit-anterior> && pnpm install --prod && pm2 reload sdr-motor`

### OpenWA
- `docker compose down && docker volume ls | grep openwa` (verificar volume existe) → `docker compose up -d` com imagem tag anterior fixada em `docker-compose.yml`

### Database
- Restore do dump feito no pré-deploy: `psql -h supa.grupototum.com -U postgres -d postgres < dump-<timestamp>.sql`
- **NUNCA:** `DROP SCHEMA totum_sdr CASCADE` sem confirmação escrita

## Referências

- SPEC completo: `SPEC-SDR-NEXT-MVP.md`
- Fase 3 (OpenWA setup): SPEC §Fase 3
- Fase 5 (build/deploy frontend): SPEC §Fase 5
- Fase 7 (go-live warm-up): SPEC §Fase 7
