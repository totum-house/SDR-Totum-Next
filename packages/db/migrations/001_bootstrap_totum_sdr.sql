-- =============================================================
-- SDR-Next — Migração inicial: schema totum_sdr
-- Aplica em: supa.grupototum.com (Supabase self-hosted)
-- Autor: Kleber B (agente) via SPEC-SDR-NEXT-MVP.md §Fase 2
-- Data: 2026-08-22
-- =============================================================
--
-- IMPORTANTE — antes de aplicar em produção:
--
--   O Postgres NÃO aceita conexão de fora: supa.grupototum.com aponta pro
--   VPS mas a 5432 está fechada. Tudo roda por SSH dentro do container
--   Docker. Procedimento completo em packages/db/README.md.
--
--   1) Backup schema-only obrigatório (sem -t: -t corrompe o dump com \r):
--        ssh claude_sftp@panel.grupototum.com \
--          "docker exec <CONTAINER> pg_dump -U postgres -d postgres --schema-only" \
--          > /tmp/supa-backup-$(date +%Y%m%d-%H%M%S).sql
--   2) CONFERIR que o backup não saiu vazio antes de seguir.
--   3) Verificar que o schema `totum_sdr` NÃO existe ainda (\dn totum_sdr).
--   4) Aguardar autorização literal "aprovado, aplica em prod" do Rael.
--   5) Aplicar empurrando por stdin:
--        ssh claude_sftp@panel.grupototum.com \
--          "docker exec -i <CONTAINER> psql -U postgres -d postgres" \
--          < packages/db/migrations/001_bootstrap_totum_sdr.sql
--   6) Validar: \dt totum_sdr.*   -- deve listar 8 tabelas
--
-- RLS: habilitada NESTA migration, junto com as policies (enable sem
-- policy trancaria as tabelas para anon/authenticated). Modelo mínimo:
-- tenant = workspace, dono = workspaces.owner_email casado com o email
-- do JWT. service_role tem bypass explícito (o motor usa service_role).
--
-- Camada L8 (🔴 vermelho, docs/PROTOCOL_CAMADAS.md) — escrito sob
-- autorização explícita do Rael (2026-08-23). Modelo de tenant é
-- OWNER-ONLY: não há tabela de membros, então só o dono do workspace
-- enxerga os dados. Convidar usuário para workspace exige uma 002 com
-- workspace_members + policy revisada.
-- =============================================================

BEGIN;

-- gen_random_uuid() é nativo no PostgreSQL 13+, mas esta migration usa a
-- função em 8 DEFAULTs — garantir pgcrypto torna o script seguro também
-- em instâncias < PG13. IF NOT EXISTS é idempotente e no-op no PG13+.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS totum_sdr;

-- --------------------------------------------------------------
-- workspaces (multi-tenant root)
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.workspaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  owner_email  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  settings     JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- --------------------------------------------------------------
-- leads
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES totum_sdr.workspaces(id) ON DELETE CASCADE,
  phone_e164    TEXT NOT NULL,
  name          TEXT,
  email         TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  source        TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, phone_e164),
  CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost'))
);
CREATE INDEX idx_leads_workspace_status ON totum_sdr.leads (workspace_id, status);

-- --------------------------------------------------------------
-- conversations (1 conversation = 1 lead × período aberto)
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES totum_sdr.workspaces(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES totum_sdr.leads(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'open',
  current_flow_id   UUID,
  current_step_id   TEXT,
  context           JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- last_activity_at = timestamp semântico (última mensagem trocada), setado
  -- explicitamente pelo motor. updated_at = timestamp técnico de qualquer
  -- UPDATE na linha, mantido pelo trigger. São propósitos diferentes.
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('open', 'waiting_human', 'closed'))
);
CREATE INDEX idx_conversations_workspace ON totum_sdr.conversations (workspace_id, status, last_activity_at DESC);

-- --------------------------------------------------------------
-- messages
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL REFERENCES totum_sdr.conversations(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content            TEXT NOT NULL,
  message_type       TEXT NOT NULL DEFAULT 'text',
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  openwa_message_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (message_type IN ('text', 'image', 'audio', 'document', 'video', 'location'))
);
CREATE INDEX idx_messages_conversation ON totum_sdr.messages (conversation_id, created_at);

-- --------------------------------------------------------------
-- flows (definição do script conversacional)
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.flows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES totum_sdr.workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  version       INT  NOT NULL DEFAULT 1,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  graph         JSONB NOT NULL,  -- { nodes: [...], edges: [...] }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_flows_workspace_active ON totum_sdr.flows (workspace_id, is_active);

-- FK adiada em conversations.current_flow_id (evita ciclo criando flows depois)
ALTER TABLE totum_sdr.conversations
  ADD CONSTRAINT fk_conversations_current_flow
  FOREIGN KEY (current_flow_id) REFERENCES totum_sdr.flows(id) ON DELETE SET NULL;

-- --------------------------------------------------------------
-- flow_runs (histórico de execução por conversation)
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.flow_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES totum_sdr.conversations(id) ON DELETE CASCADE,
  flow_id           UUID NOT NULL REFERENCES totum_sdr.flows(id),
  step_id           TEXT NOT NULL,
  node_type         TEXT NOT NULL,
  input             JSONB,
  output            JSONB,
  duration_ms       INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (node_type IN ('message', 'question', 'condition', 'improvise_with_goal', 'call_manus', 'end'))
);
CREATE INDEX idx_flow_runs_conversation ON totum_sdr.flow_runs (conversation_id, created_at);

-- --------------------------------------------------------------
-- automations (regras fora do flow principal)
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.automations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES totum_sdr.workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  trigger_type    TEXT NOT NULL,
  trigger_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type     TEXT NOT NULL,
  action_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (trigger_type IN ('lead_created', 'lead_status_changed', 'message_received', 'no_reply_24h', 'scheduled_cron')),
  CHECK (action_type  IN ('send_message', 'assign_to_human', 'tag_lead', 'call_manus', 'start_flow'))
);
CREATE INDEX idx_automations_workspace_active ON totum_sdr.automations (workspace_id, is_active);

-- --------------------------------------------------------------
-- automation_runs (histórico de disparos)
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.automation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id   UUID NOT NULL REFERENCES totum_sdr.automations(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES totum_sdr.leads(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'success',
  input           JSONB,
  output          JSONB,
  error_message   TEXT,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('success', 'error', 'skipped'))
);
CREATE INDEX idx_automation_runs_automation ON totum_sdr.automation_runs (automation_id, created_at DESC);

-- --------------------------------------------------------------
-- Trigger genérico updated_at
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION totum_sdr.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON totum_sdr.leads
  FOR EACH ROW EXECUTE FUNCTION totum_sdr.set_updated_at();

CREATE TRIGGER trg_flows_updated_at
  BEFORE UPDATE ON totum_sdr.flows
  FOR EACH ROW EXECUTE FUNCTION totum_sdr.set_updated_at();

CREATE TRIGGER trg_workspaces_updated_at
  BEFORE UPDATE ON totum_sdr.workspaces
  FOR EACH ROW EXECUTE FUNCTION totum_sdr.set_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON totum_sdr.conversations
  FOR EACH ROW EXECUTE FUNCTION totum_sdr.set_updated_at();

-- --------------------------------------------------------------
-- RLS — habilitação + policies mínimas por workspace
-- --------------------------------------------------------------

-- Email do usuário autenticado, lido do claim JWT que o PostgREST injeta.
-- Usa current_setting em vez de auth.jwt() de propósito: não cria
-- dependência do schema `auth` existir no momento do apply.
CREATE OR REPLACE FUNCTION totum_sdr.current_user_email()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'email',
    ''
  );
$$;

-- Workspaces que o usuário atual possui.
-- SECURITY DEFINER para ler workspaces sem recursão de policy.
CREATE OR REPLACE FUNCTION totum_sdr.owned_workspace_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.id
    FROM totum_sdr.workspaces w
   WHERE w.owner_email = totum_sdr.current_user_email();
$$;

ALTER TABLE totum_sdr.workspaces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.flows            ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.flow_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.automations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.automation_runs  ENABLE ROW LEVEL SECURITY;

-- Tenant root: o dono enxerga o próprio workspace.
CREATE POLICY workspaces_owner ON totum_sdr.workspaces
  FOR ALL
  USING      (owner_email = totum_sdr.current_user_email())
  WITH CHECK (owner_email = totum_sdr.current_user_email());

-- Tabelas com workspace_id direto.
CREATE POLICY leads_by_workspace ON totum_sdr.leads
  FOR ALL
  USING      (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()));

CREATE POLICY conversations_by_workspace ON totum_sdr.conversations
  FOR ALL
  USING      (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()));

CREATE POLICY flows_by_workspace ON totum_sdr.flows
  FOR ALL
  USING      (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()));

CREATE POLICY automations_by_workspace ON totum_sdr.automations
  FOR ALL
  USING      (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()));

-- Tabelas sem workspace_id: alcançadas por join.
CREATE POLICY messages_by_conversation ON totum_sdr.messages
  FOR ALL
  USING (conversation_id IN (
    SELECT c.id FROM totum_sdr.conversations c
     WHERE c.workspace_id IN (SELECT totum_sdr.owned_workspace_ids())
  ))
  WITH CHECK (conversation_id IN (
    SELECT c.id FROM totum_sdr.conversations c
     WHERE c.workspace_id IN (SELECT totum_sdr.owned_workspace_ids())
  ));

CREATE POLICY flow_runs_by_conversation ON totum_sdr.flow_runs
  FOR ALL
  USING (conversation_id IN (
    SELECT c.id FROM totum_sdr.conversations c
     WHERE c.workspace_id IN (SELECT totum_sdr.owned_workspace_ids())
  ))
  WITH CHECK (conversation_id IN (
    SELECT c.id FROM totum_sdr.conversations c
     WHERE c.workspace_id IN (SELECT totum_sdr.owned_workspace_ids())
  ));

CREATE POLICY automation_runs_by_automation ON totum_sdr.automation_runs
  FOR ALL
  USING (automation_id IN (
    SELECT a.id FROM totum_sdr.automations a
     WHERE a.workspace_id IN (SELECT totum_sdr.owned_workspace_ids())
  ))
  WITH CHECK (automation_id IN (
    SELECT a.id FROM totum_sdr.automations a
     WHERE a.workspace_id IN (SELECT totum_sdr.owned_workspace_ids())
  ));

-- --------------------------------------------------------------
-- Grants + bypass do service_role
--
-- Os roles anon/authenticated/service_role são criados pelo Supabase.
-- O bloco é guardado por pg_roles para a migration não quebrar num
-- Postgres puro (ex: banco de teste local sem Supabase em cima).
--
-- service_role no Supabase já tem BYPASSRLS, então a policy abaixo é
-- redundante na prática — está explícita para o bypass ficar legível
-- na leitura do schema, e para cobrir o caso de a role ser recriada
-- sem esse atributo.
-- --------------------------------------------------------------
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'workspaces', 'leads', 'conversations', 'messages',
    'flows', 'flow_runs', 'automations', 'automation_runs'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA totum_sdr TO service_role';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA totum_sdr TO service_role';
    FOREACH tbl IN ARRAY tables LOOP
      EXECUTE format(
        'CREATE POLICY %I ON totum_sdr.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        tbl || '_service_role', tbl
      );
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA totum_sdr TO authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA totum_sdr TO authenticated';
  END IF;

  -- anon recebe USAGE no schema mas nenhum privilégio de tabela:
  -- sem login não há email no JWT, então toda policy avaliaria falso.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA totum_sdr TO anon';
  END IF;
END $$;

COMMIT;

-- =============================================================
-- Verificação pós-apply (rodar manualmente):
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'totum_sdr' ORDER BY table_name;
--   -- esperado: 8 linhas (automation_runs, automations, conversations,
--   --                     flow_runs, flows, leads, messages, workspaces)
--
--   SELECT tablename, rowsecurity FROM pg_tables
--     WHERE schemaname = 'totum_sdr' ORDER BY tablename;
--   -- esperado: 8 tabelas com rowsecurity = true
--
--   SELECT tablename, policyname FROM pg_policies
--     WHERE schemaname = 'totum_sdr' ORDER BY tablename, policyname;
--   -- esperado: 1 policy por tabela + 1 _service_role por tabela = 16
-- =============================================================
