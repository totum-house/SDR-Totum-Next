# apps/motor — Motor SDR

Node.js CJS via PM2. Bind exclusivo `127.0.0.1:3100`.

## Módulos

| Arquivo               | Responsabilidade                                          |
|-----------------------|-----------------------------------------------------------|
| `src/server.js`       | HTTP Express: /health, /api/webhook/openwa                |
| `src/llm_provider.js` | Chain gemini → groq → nvidia (fallback rápido)            |
| `src/flow_runner.js`  | Executa graph do flow (6 tipos de nó)                     |
| `src/manus_client.js` | HTTP client para Manus (127.0.0.1:8000)                   |

## Rodar dev

```bash
pnpm install
node src/server.js
curl -s http://127.0.0.1:3100/health | jq
```

## Rodar prod (PM2)

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # apenas 1ª vez, gera systemd unit
```

## Testes

```bash
pnpm test
# → vitest cobre flow_runner (4 tipos de nó + template + condition + edges)
```

## Nós do flow (spec resumida)

- `message` — envia texto (com `{{var}}` interpolado do context)
- `question` — envia pergunta, aguarda inbound, salva em `save_as`
- `condition` — micro-DSL `context.foo == "bar"` → branch true/false
- `improvise_with_goal` — LLM autorizado a responder livre até bater `success_criteria` OU estourar `max_turns`
- `call_manus` — delega objetivo pro Manus, salva result em `save_as`
- `end` — encerra conversation (status = closed)

Detalhes em `docs/ARCHITECTURE.md` e `SPEC-SDR-NEXT-MVP.md` §Fase 4.
