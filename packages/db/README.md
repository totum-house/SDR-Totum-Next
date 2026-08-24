# packages/db — Supabase schema `totum_sdr`

Migrations versionadas para o Supabase self-hosted (`supa.grupototum.com`).

## Regras

- **1 arquivo = 1 migration atômica** (BEGIN/COMMIT explícito)
- Numeração incremental sem gap: `001_`, `002_`, ...
- Nunca editar migration já aplicada em prod — sempre criar nova
- Backup schema-only obrigatório antes de aplicar (`pg_dump --schema-only`)
- Aplicar em prod só com "aprovado, aplica em prod" literal do Rael

## Migrations

| # | Arquivo                              | Status  | Descrição                           |
|---|--------------------------------------|---------|-------------------------------------|
| 001 | `001_bootstrap_totum_sdr.sql`      | pending | Schema + 8 tabelas + RLS (enable + policies owner-only) |
| 002 | `002_totum_sdr_workspace_members.sql` | TBD  | Tabela de membros + policies revisadas (multi-usuário por workspace) |

### Modelo de RLS da 001 (owner-only)

- Tenant = `workspaces`; dono = `workspaces.owner_email` casado com o claim
  `email` do JWT (via `totum_sdr.current_user_email()`).
- Tabelas com `workspace_id` filtram direto; `messages`, `flow_runs` e
  `automation_runs` filtram por join até o workspace.
- `service_role` tem bypass explícito — é o role que o motor usa
  (`apps/motor/src/supabase_client.js`).
- `anon` recebe só `USAGE` no schema: sem login não há email no JWT, então
  toda policy avaliaria falso.
- **Limitação conhecida:** só o dono enxerga o workspace. Não há como
  convidar um segundo usuário sem a 002.

## Procedimento de apply (produção)

```bash
# 1. Backup
pg_dump -h supa.grupototum.com -U postgres -d postgres --schema-only \
  -f /tmp/supa-backup-$(date +%Y%m%d-%H%M%S).sql
sha256sum /tmp/supa-backup-*.sql | tee /tmp/supa-backup.sha256

# 2. Confirmar que o schema não existe
psql -h supa.grupototum.com -U postgres -d postgres -c "\dn totum_sdr"

# 3. Aguardar OK do Rael

# 4. Aplicar
psql -h supa.grupototum.com -U postgres -d postgres \
  -f packages/db/migrations/001_bootstrap_totum_sdr.sql

# 5. Verificar
psql -h supa.grupototum.com -U postgres -d postgres \
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema='totum_sdr' ORDER BY table_name;"
```

## Rollback

```sql
-- ATENÇÃO: destroi tudo dentro do schema totum_sdr
BEGIN;
DROP SCHEMA totum_sdr CASCADE;
COMMIT;
```

**Nunca rodar rollback sem confirmação escrita do Rael e backup fresco.**
