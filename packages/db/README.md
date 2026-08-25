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
| 002 | `002_campaigns_rules.sql`          | pending | `campaigns`, `campaign_leads`, `rules` + `conversations.campaign_id` |
| 003 | `003_totum_sdr_workspace_members.sql` | TBD  | Tabela de membros + policies revisadas (multi-usuário por workspace) |
| 00X | `00X_totum_sdr_memories.sql`       | BACKLOG | Memória semântica pgvector — ver "Gap conhecido" abaixo |

### Gap conhecido: totum_sdr não tem memória semântica

O SDR-Totum-engine antigo tinha uma capacidade que este schema **não
reproduz**. A tabela `sdr.sdr_memories` (schema antigo, ainda no banco) é:

```
id             uuid
id_lead        text            -- telefone do lead
embedding      vector(1024)    -- ivfflat, vector_cosine_ops
texto_original text
etapa_funil    text
timestamp      timestamptz
```

Ou seja: **recall semântico por similaridade**, indexado por lead e por
etapa de funil. O `totum_sdr` guarda só `messages` (texto puro) e
`conversations.context` (JSON) — não há busca por similaridade.

Verificado em 2026-08-24: 53 memórias reais de junho/2026, de leads de
produção. Decisão tomada na mesma data: **não migrar esses dados** (são
fragmentos, e `sdr.leads_sdr` está vazio, então falta o vínculo com quem
é o lead) e **não implementar vetores antes do sistema rodar** — vira
migration própria depois do primeiro ciclo real.

`pgvector` já está disponível neste Postgres, então adicionar depois é
uma migration, não uma reinstalação.

### O que a 002 acrescenta

- `campaigns` — flow + estado (`draft`/`running`/`paused`/`done`) + cota
  própria opcional. Índice parcial `uq_campaigns_one_running` garante **uma
  campanha rodando por workspace**: o workspace tem um número de WhatsApp
  só, e duas campanhas disputando a mesma cota diária tornariam o consumo
  do chip impossível de atribuir.
- `campaign_leads` — a fila de disparo, com `status`, `attempts` e
  `last_error`. O lead só sai da fila quando a mensagem sai de verdade;
  bloqueio de cota ou erro de gateway devolve para `queued`.
- `rules` — configuração por workspace em chave/valor, que a UI `/config`
  escreve. **Não consegue elevar o teto de envio** — ver
  `apps/motor/src/rules.js`, que combina YAML, banco, env e hard cap
  sempre pelo menor valor.
- `conversations.campaign_id` — coluna nova, nullable. Conversa iniciada
  pelo lead continua sem campanha.

Divergências conscientes da spec: `workspace_id` em vez de `org_id` (a 001
já estabeleceu `workspaces` como raiz do tenant) e o graph do flow segue
em `flows.graph` (JSONB) em vez de `flow_nodes`/`flow_edges` — o
`flow_runner` e o builder leem e escrevem o graph inteiro.

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
> Comandos do tipo `pg_dump -h supa.grupototum.com` falham por timeout.
>
> **Container correto: `supa-core-db`** (`supabase/postgres:17.6.1.136`),
> verificado em 2026-08-24.
>
> ⚠️ Existem **7 containers Postgres** nesse VPS: `coolify-db`,
> `totum-evo-postgres`, `whisper-db`, `infisical-db`, `totum-n8n-postgres`,
> `evolution-postgres` e `supa-core-db`. Rodar migration no errado quebra
> outro sistema em produção. Confira o nome antes de cada comando.
>
> O banco é compartilhado por vários sistemas Totum, um schema cada:
> `azl`, `hub`, `os`, `pepper`, `totum_os`, `totum_system`, `sdr`,
> `authenticative`. Por isso a regra de schema dedicado.
>
> Nota: `sdr` (leads_sdr, sdr_memories, sdr_sessions) é do SDR-Totum-engine
> antigo. **NÃO está vazio**: contagem real em 2026-08-24 deu
> leads_sdr=0, sdr_memories=53, sdr_sessions=0. Não confundir com
> `totum_sdr`, que é o schema deste projeto — e não dropar `sdr` sem
> antes decidir o que fazer com essas 53 linhas.
>
> ⚠️ `pg_stat_user_tables.n_live_tup` reportou 0 para as três tabelas,
> o que era FALSO (as stats nunca rodaram ali). Para saber se uma tabela
> tem dados, use `count(*)`, não a estimativa do coletor.

```bash
# Estes comandos rodam DENTRO do VPS (você já está logado nele).

# 1. Backup schema-only — SEM -t no docker exec, senão o dump vem com \r
docker exec supa-core-db pg_dump -U postgres -d postgres --schema-only \
  > /tmp/supa-backup-$(date +%Y%m%d-%H%M%S).sql

# 2. CONFERIR que o backup não está vazio (backup vazio = falsa segurança)
ls -lh /tmp/supa-backup-*.sql
sha256sum /tmp/supa-backup-*.sql | tee /tmp/supa-backup.sha256

# 3. Tirar o backup de /tmp — /tmp é apagado no boot
mkdir -p /root/backups && cp /tmp/supa-backup-*.sql /tmp/supa-backup.sha256 /root/backups/

# 4. Confirmar que o schema ainda não existe (esperado: 0 rows)
docker exec supa-core-db psql -U postgres -d postgres -c '\dn totum_sdr'

# 5. Aguardar "aprovado, aplica em prod" literal do Rael

# 6. Aplicar — ver "Como aplicar o SQL" abaixo

# 7. Verificar (esperado: 8 tabelas)
docker exec supa-core-db psql -U postgres -d postgres -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='totum_sdr' ORDER BY table_name;"
```

## Como aplicar o SQL

O VPS **não tem chave SSH do GitHub**, então `git clone` lá falha e o repo
não fica disponível na máquina. Duas rotas que funcionam:

**A) Supabase Studio (recomendado)** — o container `supa-core-studio` está
no ar e tem SQL Editor. Abra o arquivo local, copie o conteúdo, cole no
editor e execute. Vantagem: você lê o SQL antes de rodar, e é a mesma
ferramenta que serve de console no dia a dia.

**B) heredoc no VPS** — cole o conteúdo entre os marcadores:

```bash
cat > /root/001_bootstrap.sql <<'SQLEOF'
<conteúdo do arquivo aqui>
SQLEOF
docker exec -i supa-core-db psql -U postgres -d postgres < /root/001_bootstrap.sql
```

## Seed (depois da migration)

**EDITE o `owner_email` antes de rodar** — é o email que as policies RLS
casam com o claim do JWT. Se estiver errado, o console não enxerga nada.
Mesmas rotas A ou B acima, com `packages/db/seed/001_demo_workspace_flow.sql`.

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
