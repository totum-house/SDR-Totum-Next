-- =============================================================
-- SDR-Next — Migração 002: campanhas + fila de disparo + regras globais
-- Aplica em: supa.grupototum.com (Supabase self-hosted), schema totum_sdr
-- Depende de: 001_bootstrap_totum_sdr.sql aplicada
-- Data: 2026-08-25
-- =============================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Até aqui o motor era 100% reativo: só agia quando o lead escrevia
-- primeiro (webhook_handler.handleInboundEvent). Não havia como o Rael
-- dizer "pega estes 100 leads e começa a conversa com eles" — o
-- `dispatchToLead` existia, mas um lead por chamada, na mão.
--
-- Campanha é o objeto que faltava: um flow + uma lista de leads + um
-- estado (running/paused) que o motor consulta sozinho. E `rules` é a
-- configuração que hoje mora só em env var, sem UI.
--
-- NOMENCLATURA — divergência consciente da spec do Rael
--
-- A spec pedia `org_id`. Este schema usa `workspace_id` porque a 001 já
-- estabeleceu `workspaces` como raiz do tenant, e as policies RLS, o
-- motor (MOTOR_DEFAULT_WORKSPACE_ID) e 76 testes dependem desse nome.
-- Renomear seria uma migration destrutiva num schema já desenhado, para
-- ganhar zero. `org` e `workspace` são a mesma coisa aqui.
--
-- A spec também pedia `flow_nodes` e `flow_edges` como tabelas. Não são
-- criadas: a 001 guarda o graph inteiro em `flows.graph` (JSONB) e o
-- flow_runner lê de lá (`flow.graph.nodes` / `flow.graph.edges`).
-- Normalizar em duas tabelas exigiria reescrever o runner e os testes
-- para ganhar consultas por nó que ninguém pediu. O builder visual
-- salva o graph inteiro num UPDATE — que é o padrão de acesso real.
--
-- TETO DE ENVIO — leia antes de mexer em quota_daily
--
-- `campaigns.quota_daily` e a rule `quota_daily` NUNCA elevam o teto de
-- envio. O limite efetivo é o MENOR entre eles e o hard cap do motor
-- (apps/motor/src/rules.js). Isso é deliberado: em 2026-08-24, 10
-- mensagens saíram com o limite configurado em 2. Config de banco é
-- superfície que a UI escreve; a trava tem que viver no código.
--
-- RLS: mesmo modelo owner-only da 001 (tenant = workspace, dono =
-- workspaces.owner_email casado com o claim `email` do JWT).
-- Camada L8 (🔴 vermelho, docs/PROTOCOL_CAMADAS.md).
--
-- APPLY: procedimento completo em packages/db/README.md.
--   Verificar depois (esperado: 11 tabelas):
--     SELECT table_name FROM information_schema.tables
--      WHERE table_schema='totum_sdr' ORDER BY table_name;
-- =============================================================

BEGIN;

-- --------------------------------------------------------------
-- campaigns
--
-- flow_id com ON DELETE RESTRICT de propósito: apagar o flow que uma
-- campanha usa deixaria a campanha sem script no meio da execução.
-- Quem quiser apagar o flow apaga a campanha antes, conscientemente.
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES totum_sdr.workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  flow_id       UUID NOT NULL REFERENCES totum_sdr.flows(id) ON DELETE RESTRICT,
  status        TEXT NOT NULL DEFAULT 'draft',
  -- NULL = herda o teto global das rules. Preenchido, só ABAIXA o teto
  -- (o motor usa min(campanha, rule, hard cap) — ver rules.js).
  quota_daily   INT,
  started_at    TIMESTAMPTZ,
  stopped_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('draft', 'running', 'paused', 'done')),
  CHECK (quota_daily IS NULL OR quota_daily >= 0)
);
CREATE INDEX idx_campaigns_workspace_status ON totum_sdr.campaigns (workspace_id, status);

-- Uma campanha rodando por workspace, no máximo.
--
-- Não é limitação de implementação, é o mundo físico: o workspace tem UM
-- número de WhatsApp (OPENWA_SESSION_ID, single-tenant por deploy do
-- motor). Duas campanhas "rodando" disputariam a mesma cota diária do
-- mesmo chip, e o operador não teria como saber qual delas consumiu o
-- teto. O índice parcial faz o banco recusar o segundo `running` — o
-- motor não precisa confiar em check-then-act para isso.
CREATE UNIQUE INDEX uq_campaigns_one_running
  ON totum_sdr.campaigns (workspace_id)
  WHERE status = 'running';

-- --------------------------------------------------------------
-- campaign_leads — a fila de disparo
--
-- Tabela de junção com estado, não um `leads.campaign_id`: o mesmo lead
-- pode entrar em campanhas diferentes ao longo do tempo, e o que
-- interessa registrar é o disparo (quando saiu, deu erro, virou qual
-- conversation), não uma coluna de pertencimento.
--
-- UNIQUE (campaign_id, lead_id): mesma pessoa nunca entra duas vezes na
-- mesma campanha, nem por import duplicado nem por clique duplo.
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.campaign_leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES totum_sdr.campaigns(id) ON DELETE CASCADE,
  lead_id          UUID NOT NULL REFERENCES totum_sdr.leads(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'queued',
  conversation_id  UUID REFERENCES totum_sdr.conversations(id) ON DELETE SET NULL,
  attempts         INT  NOT NULL DEFAULT 0,
  last_error       TEXT,
  queued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at    TIMESTAMPTZ,
  UNIQUE (campaign_id, lead_id),
  CHECK (status IN ('queued', 'dispatched', 'skipped', 'failed'))
);

-- Índice do padrão de acesso mais quente: "próximo da fila desta
-- campanha". Parcial em 'queued' porque a fila só encolhe — depois de
-- disparado, a linha vira histórico e nunca mais é lida por este caminho.
CREATE INDEX idx_campaign_leads_queue
  ON totum_sdr.campaign_leads (campaign_id, queued_at)
  WHERE status = 'queued';
CREATE INDEX idx_campaign_leads_lead ON totum_sdr.campaign_leads (lead_id);

-- --------------------------------------------------------------
-- rules — configuração global por workspace (chave/valor)
--
-- Fase 1 (hoje): a fonte da verdade é packages/config/rules.yaml,
-- versionado no repo. Esta tabela é o override opcional que a UI /config
-- escreve. Fase 2: a UI vira a fonte primária e o YAML fica de default.
--
-- Chave/valor em vez de colunas nomeadas porque o conjunto de regras
-- ainda está mudando toda semana; virar coluna quando estabilizar.
-- Chaves conhecidas em 2026-08-25 (ver packages/config/rules.yaml):
--   kill_switch      bool   true = motor para tudo
--   quota_daily      int    teto de outbound/dia (só ABAIXA o teto)
--   window_start     "08:00"
--   window_end       "18:00"
--   timezone         "America/Sao_Paulo"
--   jitter_min_s     int    espera mínima entre envios
--   jitter_max_s     int    espera máxima entre envios
--   tone             text   tom padrão do SDR
-- --------------------------------------------------------------
CREATE TABLE totum_sdr.rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES totum_sdr.workspaces(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  value_json    JSONB NOT NULL,
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

-- --------------------------------------------------------------
-- conversations.campaign_id
--
-- Aditivo e nullable: conversation criada pelo webhook (lead escreveu
-- primeiro) continua sem campanha, exatamente como antes. Só o
-- campaign_runner preenche. ON DELETE SET NULL para apagar a campanha
-- não levar junto o histórico de conversa com a pessoa.
-- --------------------------------------------------------------
ALTER TABLE totum_sdr.conversations
  ADD COLUMN campaign_id UUID REFERENCES totum_sdr.campaigns(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_campaign
  ON totum_sdr.conversations (campaign_id)
  WHERE campaign_id IS NOT NULL;

-- --------------------------------------------------------------
-- Triggers updated_at (função criada na 001)
-- --------------------------------------------------------------
CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON totum_sdr.campaigns
  FOR EACH ROW EXECUTE FUNCTION totum_sdr.set_updated_at();

CREATE TRIGGER trg_rules_updated_at
  BEFORE UPDATE ON totum_sdr.rules
  FOR EACH ROW EXECUTE FUNCTION totum_sdr.set_updated_at();

-- --------------------------------------------------------------
-- RLS — mesmo modelo owner-only da 001
--
-- campaigns e rules têm workspace_id direto. campaign_leads não tem:
-- filtra por join até a campanha, como messages faz por conversation.
-- --------------------------------------------------------------
ALTER TABLE totum_sdr.campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.campaign_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE totum_sdr.rules          ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_by_workspace ON totum_sdr.campaigns
  FOR ALL
  USING      (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()));

CREATE POLICY rules_by_workspace ON totum_sdr.rules
  FOR ALL
  USING      (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT totum_sdr.owned_workspace_ids()));

CREATE POLICY campaign_leads_by_campaign ON totum_sdr.campaign_leads
  FOR ALL
  USING (campaign_id IN (
    SELECT c.id FROM totum_sdr.campaigns c
     WHERE c.workspace_id IN (SELECT totum_sdr.owned_workspace_ids())
  ))
  WITH CHECK (campaign_id IN (
    SELECT c.id FROM totum_sdr.campaigns c
     WHERE c.workspace_id IN (SELECT totum_sdr.owned_workspace_ids())
  ));

-- --------------------------------------------------------------
-- Grants + bypass do service_role para as tabelas NOVAS
--
-- A 001 rodou `GRANT ALL ON ALL TABLES` — "ALL TABLES" é resolvido no
-- momento do GRANT, não é uma regra permanente. Tabela criada depois
-- NÃO herda nada dali, então o grant precisa ser repetido aqui (mesmo
-- motivo pelo qual ALTER DEFAULT PRIVILEGES existe).
--
-- Guardado por pg_roles para a migration não quebrar num Postgres puro
-- (banco de teste local sem Supabase em cima).
-- --------------------------------------------------------------
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY['campaigns', 'campaign_leads', 'rules'];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA totum_sdr TO service_role';
    FOREACH tbl IN ARRAY tables LOOP
      EXECUTE format('GRANT ALL ON totum_sdr.%I TO service_role', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON totum_sdr.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        tbl || '_service_role', tbl
      );
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOREACH tbl IN ARRAY tables LOOP
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON totum_sdr.%I TO authenticated', tbl
      );
    END LOOP;
  END IF;
END $$;

COMMIT;
