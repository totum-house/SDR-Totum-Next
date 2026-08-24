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

> **O Postgres NÃO é acessível de fora.** `supa.grupototum.com` resolve para
> o VPS (2.24.206.161), mas a porta 5432 está fechada/filtrada — de propósito.
> Todo comando de banco roda **por SSH, dentro do container Docker**.
> Comandos do tipo `pg_dump -h supa.grupototum.com` falham por timeout.

```bash
# 0. Descobrir o container do Postgres (o nome varia por instalação)
ssh claude_sftp@panel.grupototum.com \
  "docker ps --format '{{.Names}}\t{{.Image}}' | grep -iE 'db|postgres|supabase'"

# 1. Backup schema-only — SEM -t no docker exec, senão o dump vem com \r
ssh claude_sftp@panel.grupototum.com \
  "docker exec <CONTAINER> pg_dump -U postgres -d postgres --schema-only" \
  > /tmp/supa-backup-$(date +%Y%m%d-%H%M%S).sql

# 2. CONFERIR que o backup não está vazio (backup vazio = falsa segurança)
ls -lh /tmp/supa-backup-*.sql
shasum -a 256 /tmp/supa-backup-*.sql | tee /tmp/supa-backup.sha256

# 3. Confirmar que o schema ainda não existe
ssh claude_sftp@panel.grupototum.com \
  "docker exec <CONTAINER> psql -U postgres -d postgres -c '\\dn totum_sdr'"

# 4. Aguardar "aprovado, aplica em prod" literal do Rael

# 5. Aplicar, empurrando o arquivo local por stdin (não precisa clonar no VPS)
ssh claude_sftp@panel.grupototum.com \
  "docker exec -i <CONTAINER> psql -U postgres -d postgres" \
  < packages/db/migrations/001_bootstrap_totum_sdr.sql

# 6. Verificar
ssh claude_sftp@panel.grupototum.com \
  "docker exec <CONTAINER> psql -U postgres -d postgres -c \
   \"SELECT table_name FROM information_schema.tables WHERE table_schema='totum_sdr' ORDER BY table_name;\""
```

## Seed (depois da migration)

```bash
# EDITE o owner_email no arquivo antes — é o email que as policies RLS
# casam com o claim do JWT. Errado = console não enxerga nada.
ssh claude_sftp@panel.grupototum.com \
  "docker exec -i <CONTAINER> psql -U postgres -d postgres" \
  < packages/db/seed/001_demo_workspace_flow.sql
```

O seed imprime o UUID do workspace no final — vai em `MOTOR_DEFAULT_WORKSPACE_ID`
no `.env` do VPS.

## Rollback

```sql
-- ATENÇÃO: destroi tudo dentro do schema totum_sdr
BEGIN;
DROP SCHEMA totum_sdr CASCADE;
COMMIT;
```

**Nunca rodar rollback sem confirmação escrita do Rael e backup fresco.**
