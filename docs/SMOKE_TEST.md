# Smoke test end-to-end — SDR-Next

Roteiro para confirmar que o sistema inteiro funciona: importar leads →
montar flow → criar campanha → disparar → ver no `/live` → receber
resposta, com a cota e o kill switch se comportando.

Existe em duas versões. **Rode a versão mock primeiro** — ela cobre tudo
menos o WhatsApp de verdade, e não gasta cota de um número em warm-up.

---

## Pré-requisitos

| # | Item | Como confirmar |
|---|---|---|
| 1 | Migrations 001 e 002 aplicadas | `\dt totum_sdr.*` lista **11 tabelas** |
| 2 | Seed rodado, workspace existe | o seed imprime o UUID no final |
| 3 | `.env` preenchido | `MOTOR_DEFAULT_WORKSPACE_ID` = UUID do passo 2 |
| 4 | Motor no ar | `curl 127.0.0.1:3100/health` → `{"status":"ok"}` |
| 5 | Painel no ar | `pnpm dev` em `apps/web` → `127.0.0.1:3200` |

> As migrations **não estão aplicadas em prod** enquanto não houver
> "aprovado, aplica em prod" literal do Rael. Procedimento e backup
> obrigatório em [`packages/db/README.md`](../packages/db/README.md).

---

## Versão A — modo mock (sem WhatsApp)

Roda o motor inteiro — flow, cota, jitter, `/live`, persistência — com o
envio virando log. Serve para validar tudo antes de o gateway existir, e
para ensaiar flow novo sem gastar cota do chip.

```bash
# no .env do motor
MOTOR_MOCK_SEND=true
WARMUP_DAILY_LIMIT=2
WARMUP_ENABLED=true
```

1. **Importar leads.** `/leads/import` → suba um CSV:

   ```csv
   phone,name,tags
   5531999990001,Teste 1,smoke
   5531999990002,Teste 2,smoke
   5531999990003,Teste 3,smoke
   5531999990004,Teste 4,smoke
   5531999990005,Teste 5,smoke
   ```

   ✅ A tela diz `5 lead(s) importado(s)`.
   ✅ Subir o **mesmo arquivo de novo** deve dizer `0 importados,
   5 já existiam` — reimport não duplica.

2. **Montar o flow.** `/builder` → *Novo flow* → três nós:
   `mensagem → pergunta → mensagem`, ligados em sequência, o primeiro
   marcado como início. *Salvar*.
   ✅ Salvar um flow com aresta solta ou tipo inválido deve **falhar** com
   mensagem explicando — a validação é do servidor.

3. **Criar a campanha.** `/campanhas/nova` → nome, o flow do passo 2,
   segmento tag `smoke`. ✅ Nasce em `draft` com 5 na fila.

4. **Disparar.** Abra `/live` numa aba, volte e clique *Iniciar*.
   ✅ `/live` mostra `campanha iniciada`.
   ✅ Em até ~10s aparece a primeira `enviada`.
   ✅ O log do motor mostra `[openwa:mock] NÃO enviado → …`.

5. **Cota.** Espere o segundo disparo (30-120s de jitter).
   ✅ Depois de **2 mensagens**, `/live` mostra `cota` e para.
   ✅ `/campanhas/<id>` mostra "cota do dia esgotada" como impedimento.
   ✅ Os 3 leads restantes continuam `queued` — ninguém sai da fila sem
   mensagem ter saído.

6. **Kill switch.** `/config` → *PARAR TUDO*.
   ✅ `/live` mostra `kill switch` no próximo ciclo, em **menos de 30s**.
   ✅ `GET /api/status` do motor volta `kill_switch: true`.

Para repetir no mesmo dia, a cota já foi gasta: suba
`WARMUP_DAILY_LIMIT` **só no ambiente de teste** (o hard cap de 100
continua valendo) ou apague as `messages` outbound de hoje.

### Atalho: forçar um ciclo sem esperar o jitter

```bash
curl -X POST 127.0.0.1:3100/api/campaigns/tick \
  -H "Authorization: Bearer $OPENWA_WEBHOOK_TOKEN"
```

Pula **só a espera** — kill switch, janela e cota continuam valendo.

---

## Versão B — com WhatsApp real

Só depois de a versão A passar inteira.

```bash
MOTOR_MOCK_SEND=false
```

Pré-requisito extra: sessão OpenWA conectada e webhook registrado
apontando para o motor — ver [`apps/openwa/README.md`](../apps/openwa/README.md).

1. Troque os 5 leads de teste por **1 número real seu**.
2. Repita os passos 2 a 4 da versão A.
   ✅ A mensagem chega no WhatsApp de destino.
3. **Responda pelo WhatsApp.**
   ✅ `/live` mostra `recebida` com o texto.
   ✅ Se o nó for `pergunta`, o motor avança o flow e responde.
   ✅ `totum_sdr.messages` tem as duas linhas, `inbound` e `outbound`.

> ⚠️ Cada mensagem daqui gasta cota real do chip em warm-up. Com o teto
> em 2/dia, o teste consome o dia inteiro — planeje.

---

## Definition of Done

| Critério | Onde se verifica |
|---|---|
| Importa CSV | passo 1 |
| Cria flow visual com 3 nós | passo 2 |
| Cria campanha e dispara | passos 3-4 |
| Mensagem chega no WhatsApp | versão B, passo 2 |
| Resposta aparece no `/live` | versão B, passo 3 |
| Quota diária respeitada | passo 5 |
| Kill switch para tudo em <30s | passo 6 |
| Rael loga via SSO | **pendente** — ver abaixo |

### Pendência conhecida: autenticação

O `middleware.ts` confere a **presença** do cookie SSO, não a assinatura
dele, e as páginas nem passam pelo middleware (o matcher cobre só
`/api/*`). O painel lê o banco com `service_role`, que bypassa RLS.

Na prática: **hoje o painel é single-tenant e depende de não estar
exposto publicamente**. As policies das migrations 001/002 existem e
funcionam, mas quem as exercita é o usuário autenticado — que ainda não
existe neste app.

Fechar isso é conectar o Supabase Auth (camada L8, 🔴 vermelho em
[`PROTOCOL_CAMADAS.md`](PROTOCOL_CAMADAS.md)): trocar o client de
`service_role` por anon key + JWT do usuário, e estender o matcher do
middleware para as páginas. As queries do painel não mudam — elas já
filtram por `workspace_id` na mão.
