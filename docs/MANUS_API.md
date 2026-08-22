# MANUS API — contrato assumido

**Status:** stub. Validar contra Manus real rodando em `manus.grupototum.com` /
`127.0.0.1:8000` antes de considerar canônico.

Motor SDR (`apps/motor/src/manus_client.js`) fala este contrato via `axios.post`.
Se a API real divergir, atualiza o client e este doc no mesmo commit.

---

## Endpoint

```
POST http://127.0.0.1:8000/task
```

Em cloud/prod eventual: `https://manus.grupototum.com/task` — porém motor sempre
prefere `127.0.0.1` porque roda no mesmo host do Manus (D-017).

## Auth

Header opcional:
```
Authorization: Bearer <MANUS_TOKEN>
```

Se `MANUS_TOKEN` não estiver no env, motor NÃO envia o header (útil em dev local
sem auth). Prod SEMPRE exige.

## Request

```json
{
  "objective": "Pesquisar CNPJ 11.222.333/0001-44 e retornar razão social + sócios",
  "context": {
    "lead_name": "Rael",
    "cargo": "CEO",
    "__flow_id": "flow-1",
    "__conversation_id": "conv-abc"
  },
  "timeout_ms": 60000
}
```

Campos:
- `objective` (string, obrigatório) — instrução em linguagem natural pro Manus executar
- `context` (object, opcional) — variáveis do flow que o Manus pode usar
- `timeout_ms` (number, opcional, default 60000) — deadline lado Motor. Manus deve tentar concluir dentro.

## Response — sucesso

```json
{
  "status": "ok",
  "task_id": "manus-task-uuid",
  "duration_ms": 4321,
  "result": {
    "razao_social": "Totum Marketing Ltda",
    "socios": ["Israel Lemos"],
    "raw": "…texto completo do Manus…"
  }
}
```

Motor salva o objeto inteiro (`data`) em `context[node.save_as]`. Flow decide se
usa `context.foo.result.razao_social` ou o `raw`.

## Response — erro

```json
{
  "status": "error",
  "error": "timeout" | "auth" | "internal" | "objective_impossible",
  "message": "Descrição humana",
  "task_id": "manus-task-uuid"
}
```

Motor atualmente **propaga** o erro (throw). Flow runner NÃO tem retry automático
— fica na responsabilidade do flow (colocar `improvise_with_goal` como fallback
ou `condition` checando `context.foo.status == "error"`).

## Timeout

- Cliente axios: `timeout_ms + 5000` (5s buffer de rede)
- Servidor Manus: deve respeitar `timeout_ms`
- Se estourar: cliente lança `AxiosError code=ECONNABORTED`

## Idempotência

**Não garantida.** Chamadas repetidas com mesmo objective podem produzir tasks
diferentes no Manus. Se precisar idempotência, flow deve passar
`context.__idempotency_key = <hash-conversation-step>` e Manus tratar do lado dele.

---

## Fluxo end-to-end

```
Flow node call_manus
  → flow_runner.stepCallManus()
    → manusClient.callManus({objective, context, timeout_ms})
      → axios.post http://127.0.0.1:8000/task
        → Manus executa (browser, terminal, LLM, tools)
      ← response {status, result}
    ← data completo
  ← salva em context[save_as]
→ próximo nó via edge
```

## Smoke test

`apps/motor/scripts/test-manus.js` — script CLI que chama `callManus` com
objective de teste. Requer `MANUS_URL` + `MANUS_TOKEN` no env.

```bash
node apps/motor/scripts/test-manus.js "Retorne 'pong' em JSON"
```

## Divergências conhecidas / a validar

- [ ] Campo exato do endpoint (`/task` vs `/execute` vs `/run`)
- [ ] Header de auth (Bearer vs X-API-Key vs Basic)
- [ ] Formato de erro (JSON vs texto vs HTTP status semântico)
- [ ] Suporte a streaming (SSE?) — motor hoje assume request/response único
- [ ] Rate limit por token / por objetivo

Atualizar quando Rael conectar Motor ao Manus real pela primeira vez.
