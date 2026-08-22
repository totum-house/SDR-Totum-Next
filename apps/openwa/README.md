# apps/openwa — Gateway WhatsApp

OpenWA v0.23.1 rodando em Docker. Faz ponte entre WhatsApp Web e o Motor SDR.

## Regras críticas

- **Bind exclusivo em `127.0.0.1:3000`** — nunca `0.0.0.0`
- **Exposição pública apenas via Traefik** (`openwa.grupototum.com`) com Basic Auth
- **Volume `sessions/` é CRÍTICO** — contém a sessão WhatsApp autenticada; perder = precisa escanear QR de novo
- **Número: VoIP DID 3131577292** (ver `MEMORY.md`); trocar número exige apagar `sessions/` primeiro
- **QR code só é escaneado por decisão do Rael** — nunca automático

## Setup local (dev)

```bash
cp ../../.env.example .env
# Preenche OPENWA_WEBHOOK_TOKEN com valor forte (openssl rand -hex 32)

docker compose up -d
docker compose logs -f openwa
```

Nos logs, procure `QR code:` — copie a string base64 e cole em https://webqr.com/ ou use um leitor local para renderizar.

## Verificação (health)

```bash
curl -s http://127.0.0.1:3000/health | jq
# → { "status": "ok", "wa_connected": false }  (antes do QR)
# → { "status": "ok", "wa_connected": true }   (depois do QR)
```

## Trocar de número

**Atenção: destroi a sessão atual. Só faça com autorização do Rael.**

```bash
docker compose stop openwa
sudo rm -rf sessions/*
docker compose up -d
docker compose logs -f openwa   # espera novo QR
```

## Webhook

Configurado em `WEBHOOK_URL=http://host.docker.internal:3100/api/webhook/openwa`.

Cada evento inbound do WhatsApp bate no Motor SDR (porta 3100) com header:

```
Authorization: Bearer <OPENWA_WEBHOOK_TOKEN>
```

Motor valida o token antes de processar (ver `apps/motor/src/server.js`).

## MCP nativo

OpenWA expõe MCP em `http://127.0.0.1:3000/mcp`. O Motor pode consumir como cliente para operações complexas (ex: buscar histórico, gerenciar contatos). `MCP_READONLY=false` está ligado — o Motor pode enviar mensagens via MCP também.

## Backup obrigatório antes de qualquer redeploy

```bash
tar czf ~/openwa-session-backup-$(date +%Y%m%d-%H%M%S).tgz sessions/
sha256sum ~/openwa-session-backup-*.tgz
```

## Portas & endpoints principais

| Endpoint                        | Descrição                              |
|---------------------------------|----------------------------------------|
| `GET  /health`                  | Health check                           |
| `POST /sendText`                | Enviar mensagem de texto               |
| `POST /sendImage`               | Enviar imagem                          |
| `GET  /getContacts`             | Listar contatos                        |
| `POST /mcp`                     | Endpoint MCP nativo                    |

Referência completa: https://github.com/rmyndharis/OpenWA (fork v0.23.1)

## Troubleshooting

| Sintoma                          | Causa provável                    | Ação                                                    |
|----------------------------------|-----------------------------------|---------------------------------------------------------|
| QR não aparece nos logs          | Puppeteer/Chrome faltando         | `docker compose pull && docker compose up -d`           |
| `wa_connected: false` persiste   | QR expirou (60s)                  | `docker compose restart openwa` e escanear rápido       |
| Webhook não bate no motor        | `host.docker.internal` bloqueado  | Confirmar `extra_hosts` no compose + Motor em 127.0.0.1 |
| Sessão perdida após reboot       | Volume não montado                | Verificar `./sessions:/sessions` no compose             |
| Bloqueio WhatsApp                | Warm-up violado                   | PARA tudo, aciona kill switch, avisa Rael               |
