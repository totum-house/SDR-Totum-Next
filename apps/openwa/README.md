# apps/openwa — Gateway WhatsApp

> Reescrito em 2026-08-24. A versão anterior deste doc (e o
> `docker-compose.yml` que estava aqui) descrevia um projeto **errado**
> (`openwa/wa-automate`, porta 3000, "MCP nativo" que nunca existiu).
> O projeto real é [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA),
> porta 2785, API REST documentada via Swagger — confirmado rodando no VPS.

## O que este diretório NÃO é

Não há `docker-compose.yml` aqui. A instância real roda a partir do **próprio
repo do OpenWA**, clonado direto no VPS (`/opt/OpenWA`), com o
`docker-compose.dev.yml` deles — não o nosso. Gerenciar um compose paralelo
aqui só criaria duas fontes de verdade divergentes.

## Setup (feito uma vez, no VPS)

```bash
cd /opt && git clone https://github.com/rmyndharis/OpenWA.git && cd OpenWA
docker compose -f docker-compose.dev.yml up -d
```

Confirme o bind antes de qualquer outra coisa — **tem que ser só loopback**:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -i openwa
# esperado: 127.0.0.1:2785->2785/tcp
```

Se aparecer `0.0.0.0:2785`, está exposto na internet. Corrigir antes de seguir.

## Contrato da API (verificado, não suposição)

Base: `http://127.0.0.1:2785/api` · Swagger: `http://127.0.0.1:2785/api/docs`
· Spec JSON: `http://127.0.0.1:2785/api/docs-json`

- **Auth**: header `X-API-Key` em toda chamada. Chaves são criadas via
  `POST /api/auth/api-keys` (endpoint "admin only" — a própria API se
  auto-gerencia).
- **Tudo é escopado por sessão**: `/api/sessions/{sessionId}/...`. Uma
  sessão = uma conexão WhatsApp = um número. Criar com `POST /api/sessions`
  (`{ name }`), iniciar com `POST /api/sessions/{id}/start`, QR em
  `GET /api/sessions/{id}/qr`.
- **Enviar texto**: `POST /api/sessions/{id}/messages/send-text`
  `{ chatId: "<telefone>@c.us", text }` — `text` tem `maxLength: 4096`
  (nosso guardrail em `flow_runner.js` já corta bem antes disso, em 900).
- **Webhook**: registrado via API, não por env var —
  `POST /api/sessions/{id}/webhooks`
  `{ url, events: ["message.received", ...], secret, headers }`.
  Usar o campo `headers` para mandar `{"Authorization": "Bearer <token>"}`
  — é esse header que `apps/motor/src/server.js` valida
  (`OPENWA_WEBHOOK_TOKEN`, comparação em tempo constante).
- **Checar número antes de enviar**: `GET /api/sessions/{id}/contacts/check/{number}`
  — usado por `apps/motor/src/openwa_client.js` (`checkNumber`) para não
  disparar para número inexistente, sinal forte de conta automatizada.
- **Presença**: `POST /api/sessions/{id}/chats/typing` — "digitando...".
  Usado por `setTyping` no client.
- **Pacing/circuit breaker PRÓPRIOS do OpenWA** (eventos de auditoria
  `send_pacing_blocked`, `send_breaker_tripped`). O motor mantém a trava de
  warm-up dele (`apps/motor/src/warmup.js`) como fonte da verdade da cota
  diária — os dois nunca devem ser configurados como regras ativas
  conflitantes. Ver `GET /api/sessions/{id}/config` para o que o OpenWA
  aplica por conta própria antes de decidir se folgar essa configuração.

Payloads completos de cada rota: consultar o Swagger direto (`/api/docs`)
ou o JSON (`/api/docs-json`) — mais confiável que copiar aqui e deixar
desatualizar de novo.

## Rede: container OpenWA ↔ motor no host

O container `openwa-api` roda numa bridge Docker própria
(`openwa-network`, não `network_mode: host`). Isso quebra a suposição
óbvia de "tudo é 127.0.0.1" de três jeitos diferentes, descobertos e
resolvidos em 2026-08-24 ao ligar o webhook pela primeira vez:

1. **127.0.0.1 do host é inalcançável do container.** Loopback nunca
   atravessa namespace de rede — não é o mesmo problema que
   `host.docker.internal` resolve (esse resolve nome, não contorna a
   regra do kernel). O motor precisa bindar TAMBÉM no endereço da
   bridge (`MOTOR_EXTRA_BIND`, ver `.env.example` e
   `apps/motor/src/server.js`) — nunca em `0.0.0.0`.

2. **O endereço da bridge não é fixo por nome.** É o Gateway da rede
   Docker, descoberto com:
   ```bash
   docker inspect openwa-api --format '{{range $k,$v := .NetworkSettings.Networks}}{{$v.Gateway}}{{end}}'
   ```
   Em 2026-08-24 era `10.0.16.1`. **Pode mudar** se a rede for recriada
   (`docker compose down` seguido de `up`, não só restart) — conferir
   de novo se o webhook parar de bater no motor depois disso.

3. **O SSRF guard do próprio OpenWA bloqueia IP privado por padrão** —
   registrar um webhook apontando pra bridge IP falha com
   `"Destination address is not allowed"` até liberar em
   `SSRF_ALLOWED_HOSTS` (env do container, em `/opt/OpenWA/.env`,
   requer recriar só o container `openwa-api` — `docker compose -f
   docker-compose.dev.yml up -d`, não afeta outro serviço, é o único
   serviço nesse compose).

4. **`ufw` no host tem `policy DROP` em INPUT** e só libera porta por
   interface específica (mesmo padrão já usado por outros serviços
   Totum nessa VPS — `8765/tcp on docker0`, `18789/tcp on
   br-b53e9f22ed07`). Sem uma regra equivalente, o tráfego do container
   pro host morre em timeout silencioso (não é rejection, é DROP — bem
   mais difícil de diagnosticar que um 401/403). A interface é
   `br-` + 12 primeiros chars do ID da rede Docker:
   ```bash
   docker network inspect openwa-network --format '{{.Id}}'   # ex: fd326656db06...
   ufw allow in on br-fd326656db06 to any port 3100 proto tcp comment 'sdr-motor via openwa-network'
   ```
   Essa regra só aceita tráfego que chega POR aquela bridge específica
   — não abre a porta pra internet nem pras outras redes Docker da
   máquina.

Depois de resolver os quatro pontos, validar com o endpoint de teste do
próprio OpenWA (mais representativo que `docker exec ... curl`, porque
usa o client HTTP real deles):
```bash
curl -X POST http://127.0.0.1:2785/api/sessions/{sessionId}/webhooks/{webhookId}/test \
  -H "X-API-Key: $OPENWA_API_KEY"
# esperado: {"success":true,"statusCode":200}
```

## Regras críticas

- **Bind exclusivo em `127.0.0.1:2785`** — nunca `0.0.0.0`
- **Exposição externa (se um dia precisar)**: só via Traefik com Basic
  Auth ou IP allowlist. Hoje o acesso é por túnel SSH
  (`ssh -L 2785:127.0.0.1:2785 usuario@panel.grupototum.com`, rodado no
  seu computador, não no VPS).
- **QR code só é escaneado por decisão explícita do Rael** — nunca automático
- **Sessão é o dado crítico** — perder a sessão = escanear QR de novo.
  Persistida em `/opt/OpenWA/data` no host (volume `./data:/app/data`
  no `docker-compose.dev.yml` deles — confirmado 2026-08-24). Backup
  desse diretório antes de qualquer `docker compose down` ou redeploy.

## Verificação

```bash
curl -s http://127.0.0.1:2785/api/health | jq
curl -s -H "X-API-Key: $OPENWA_API_KEY" http://127.0.0.1:2785/api/sessions | jq
```

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| `401` em qualquer chamada | falta `X-API-Key` ou chave inválida | conferir `OPENWA_API_KEY` |
| Envio falha com sessão "not found" | `OPENWA_SESSION_ID` errado ou sessão não iniciada | `GET /api/sessions` pra listar as existentes |
| Webhook não bate no motor, timeout (não erro) | falta `MOTOR_EXTRA_BIND`, falta regra `ufw` pra bridge, ou gateway mudou | ver seção "Rede: container ↔ host" acima — testar com o endpoint `/webhooks/{id}/test` |
| Registrar webhook dá `Destination address is not allowed` | SSRF guard do OpenWA sem o IP liberado | `SSRF_ALLOWED_HOSTS` em `/opt/OpenWA/.env`, recriar o container |
| Bloqueio WhatsApp | warm-up violado | PARA tudo, aciona kill switch (`WARMUP_ENABLED=false`), avisa Rael |
