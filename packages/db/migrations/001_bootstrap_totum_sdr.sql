-- =============================================================
-- SDR-Next — Migração inicial: schema totum_sdr
-- Aplica em: supa.grupototum.com (Supabase self-hosted)
-- Autor: Kleber B (agente) via SPEC-SDR-NEXT-MVP.md §Fase 2
-- Data: 2026-08-22
-- =============================================================
--
-- IMPORTANTE — antes de aplicar em produção:
--   1) Backup schema-only obrigatório:
--        pg_dump -h supa.grupototum.com -U postgres -d postgres --schema-only \
--          -f /tmp/supa-backup-$(date +%Y%m%d-%H%M%S).sql
--        sha256sum /tmp/supa-backup-*.sql > /tmp/supa-backup.sha256
--   2) Verificar que schema `totum_sdr` NÃO existe ainda:
--        \dn totum_sdr
--   3) Aguardar autorização literal "aprovado, aplica em prod" do Rael.
--   4) Aplicar em bloco único:
--        psql -h supa.grupototum.com -U postgres -d postgres \
--          -f packages/db/migrations/001_bootstrap_totum_sdr.sql
--   5) Validar:
--        \dt totum_sdr.*   -- deve listar 7 tabelas
--
-- RLS: NÃO habilitada nesta migration (nem enable, nem policies).
-- Habilitar RLS sem policy nenhuma bloqueia acesso de roles não-owner
-- (anon/authenticated) às tabelas — não há como aplicar isso com
-- segurança sem policy no mesmo commit, e RLS/policies é camada L8
-- (🔴 vermelho — nunca sozinho, ver docs/PROTOCOL_CAMADAS.md) até
-- Auth estar conectada e os tenants definidos com aprovação do Rael.
-- Enable + CREATE POLICY virão juntos em 002_totum_sdr_rls_policies.sql.
-- =============================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS totum_sdr;

-- --------------------------------------------------------------
-- workspaces (multi-tenant root)
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.workspaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  owner_email  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
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

COMMIT;

-- =============================================================
-- Verificação pós-apply (rodar manualmente):
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'totum_sdr' ORDER BY table_name;
--   -- esperado: 8 linhas (automation_runs, automations, conversations,
--   --                     flow_runs, flows, leads, messages, workspaces)
--
--   RLS ainda NÃO habilitada em nenhuma tabela desta migration — só
--   acesso via service_role até 002_totum_sdr_rls_policies.sql
--   (enable + policy no mesmo commit, aprovado pelo Rael).
-- =============================================================
