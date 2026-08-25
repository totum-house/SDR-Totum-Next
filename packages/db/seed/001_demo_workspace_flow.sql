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
-- Rodar (procedimento completo, incluindo container do VPS, em
-- packages/db/README.md):
--   docker exec -i <CONTAINER> psql -U postgres -d postgres \
--     < packages/db/seed/001_demo_workspace_flow.sql
--
-- Depois, pegue o UUID impresso no final e ponha no .env do VPS como
-- MOTOR_DEFAULT_WORKSPACE_ID.
--
-- IDEMPOTÊNCIA: totum_sdr.workspaces NÃO tem UNIQUE em `name` nem
-- `owner_email` (só PK em `id`, sempre um UUID novo) — por isso o
-- INSERT abaixo usa WHERE NOT EXISTS em vez de ON CONFLICT DO NOTHING.
-- ON CONFLICT precisa de uma constraint pra saber o que é "conflito";
-- sem uma, ele não impede nada e cada execução cria uma workspace nova
-- (bug real, encontrado em produção em 2026-08-24 — o seed rodou 2x e
-- criou 2 workspaces "Totum SDR" antes desta correção).
-- =============================================================

BEGIN;

INSERT INTO totum_sdr.workspaces (name, owner_email)
SELECT 'Totum SDR', 'TROQUE_AQUI@grupototum.com'
WHERE NOT EXISTS (
  SELECT 1 FROM totum_sdr.workspaces WHERE name = 'Totum SDR'
);

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
