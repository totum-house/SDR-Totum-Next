-- =============================================================
-- SDR-Next — Seed: 1 workspace + 1 flow mínimo executável
-- Depende de: packages/db/migrations/001_bootstrap_totum_sdr.sql aplicada
-- =============================================================
--
-- Cobre o critério de aceite do SPEC §6:
--   "1 flow simples criado (saudação → pergunta nome → salva no lead → despede)"
--
-- ANTES DE RODAR: troque o owner_email abaixo pelo email que você usa
-- no Supabase Auth. É esse email que as policies RLS da 001 casam com o
-- claim do JWT — se estiver errado, o console não enxerga nada.
--
-- Rodar:
--   psql -h supa.grupototum.com -U postgres -d postgres \
--     -f packages/db/seed/001_demo_workspace_flow.sql
--
-- Depois, pegue o UUID impresso no final e ponha no .env do VPS como
-- MOTOR_DEFAULT_WORKSPACE_ID.
-- =============================================================

BEGIN;

INSERT INTO totum_sdr.workspaces (name, owner_email)
VALUES ('Totum SDR', 'TROQUE_AQUI@grupototum.com')
ON CONFLICT DO NOTHING;

INSERT INTO totum_sdr.flows (workspace_id, name, version, is_active, graph)
SELECT
  w.id,
  'Saudação e captura de nome',
  1,
  true,
  '{
    "entry_step_id": "msg_saudacao",
    "nodes": [
      {
        "id": "msg_saudacao",
        "type": "message",
        "text": "Oi! Aqui é o assistente da Totum 👋"
      },
      {
        "id": "q_nome",
        "type": "question",
        "text": "Como posso te chamar?",
        "save_as": "lead_name"
      },
      {
        "id": "msg_despedida",
        "type": "message",
        "text": "Prazer, {{lead_name}}! Já passo seu contato pro time e a gente se fala."
      },
      { "id": "fim", "type": "end" }
    ],
    "edges": [
      { "source": "msg_saudacao",  "target": "q_nome" },
      { "source": "q_nome",        "target": "msg_despedida" },
      { "source": "msg_despedida", "target": "fim" }
    ]
  }'::jsonb
FROM totum_sdr.workspaces w
WHERE w.name = 'Totum SDR'
  AND NOT EXISTS (
    SELECT 1 FROM totum_sdr.flows f
     WHERE f.workspace_id = w.id
       AND f.name = 'Saudação e captura de nome'
  );

COMMIT;

-- Pegue este UUID e coloque em MOTOR_DEFAULT_WORKSPACE_ID no .env:
SELECT id AS motor_default_workspace_id, name, owner_email
  FROM totum_sdr.workspaces
 WHERE name = 'Totum SDR';
